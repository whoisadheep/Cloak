import os
import sys
import json
import re
import click
import anthropic
from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table
from rich.prompt import IntPrompt
from rich.markdown import Markdown

console = Console()

SYSTEM_PROMPT = """
You are Cloak, an expert career coach and resume data extractor. 
Your job is to have a warm, encouraging conversation with the user 
to collect their professional information, then structure it perfectly 
into a resume JSON schema.

CONVERSATION RULES:
- Ask ONLY ONE question at a time.
- WAIT for the user's answer before asking the next question.
- Start by asking for their full name.
- Be conversational, warm, and professional. Never sound like a form.
- Guide section by section: Personal Info → Summary → Education → Work Experience → Projects → Skills → Certifications.
- CRITICAL: You MUST explicitly ask the user if they have any Work Experience. Collect their companies, roles, dates, and achievements. Only skip this section if they explicitly state they have no experience.
- For Education: Ask for their CGPA, percentage, or GPA. Store it in the "percentage" field as-is (e.g. "8.5 CGPA", "92%", "3.8 GPA"). If they don't have one or skip, omit the field.
- If the user has no certifications, skip/remove the certifications section.
- Keep responses concise. No long paragraphs.

DATA ENHANCEMENT RULES:
- Improve grammar professionally for resume use.
- Make project bullet points stronger and ATS-friendly (ask for metrics/impact if missing).
- Do NOT invent fake companies or fake experience unless explicitly asked.
- If the user gives short answers, expand them professionally.
- Dates must be in format "Mon YYYY" e.g. "Jan 2021" or "Present".
- Skills must be grouped into logical categories.

COMPLETION:
- Keep the JSON format clean and valid.
- When the user confirms all sections are done, you MUST output the final JSON block.
- IMMEDIATELY AFTER the CLOAK_JSON_END tag, write a brief, encouraging analysis of their completed resume. Highlight 1-2 strong points, and suggest 1-2 areas they could improve or tailor further.
- CRITICAL: If the user uploads a profile photo (the system will provide a file path like /static/uploads/...), you MUST save that exact path into the `photo_url` field under personal.
- You MUST use exactly these JSON keys and structure:

CLOAK_JSON_START
{
  "personal": {
    "name": "...",
    "title": "...",
    "email": "...",
    "phone": "...",
    "location": "...",
    "linkedin": "...",
    "github": "...",
    "photo_url": "..."
  },
  "summary": "...",
  "education": [
    {
      "institution": "...",
      "degree": "...",
      "field": "...",
      "year": "...",
      "percentage": "..."
    }
  ],
  "experience": [
    {
      "company": "...",
      "title": "...",
      "location": "...",
      "start": "...",
      "end": "...",
      "bullets": [
        "..."
      ]
    }
  ],
  "projects": [
    {
      "name": "...",
      "link": "...",
      "tech": "...",
      "bullets": [
        "..."
      ]
    }
  ],
  "skills": {
    "Category Name": ["skill 1", "skill 2"]
  },
  "certifications": [
    {
      "name": "...",
      "issuer": "...",
      "year": "..."
    }
  ],
  "custom_section_name": [
    {
      "name": "...",
      "subtitle": "...",
      "year": "...",
      "bullets": ["..."]
    }
  ]
}
CLOAK_JSON_END

- The JSON must follow the schema above.
- CRITICAL: The JSON key order MUST match the schema order shown above: personal → summary → education → experience → projects → skills → certifications. Experience MUST come before Projects (except in student mode).
- You MAY add custom top-level keys (e.g., "awards", "volunteering", "languages") if the user explicitly asks to add a new section OR if the user's uploaded/existing resume already contains such sections. Keep the structure as a list of objects. Do not stuff them into "certifications".
- CRITICAL: When a user uploads an existing resume, you MUST preserve ALL sections from it, including any non-standard sections (awards, publications, volunteer work, languages, hobbies, etc.). Never silently remove sections that exist in the uploaded resume.
"""

LIVE_PREVIEW_INSTRUCTION = """
ADDITIONAL INSTRUCTION:
After every turn, if you have gathered any valid resume JSON data so far, output the current draft JSON enclosed uniquely in <live_preview>...</live_preview> tags at the very end of your message. The CLI needs this for dynamic terminal highlighting.
"""

STUDENT_RULES = """
STUDENT MODE DIRECTIVES:
- The user appears to be a student, fresher, or career switcher. Ask them if they have any internships, part-time jobs, or relevant work experience. If they say no, skip the Experience section entirely and set "experience": [].
- Shift focus to Projects, which becomes the primary credibility section for students. Ask for 3-4 strong project entries instead of the usual 2.
- Reorder the JSON output for students as: Personal -> Summary -> Projects -> Education -> Experience -> Skills -> Certifications
- In the summary, frame them as a student or entry-level professional — never mention "years of experience" language.
"""

def truncate_json(data):
    """Recursively truncates JSON dicts and lists to just show object shapes (collapsed view)."""
    if isinstance(data, dict):
        truncated = {}
        for k, v in data.items():
            if isinstance(v, list):
                if not v:
                    truncated[k] = []
                elif isinstance(v[0], dict):
                    truncated[k] = f"[{len(v)} entries]"
                else:
                    truncated[k] = f"[{len(v)} items]"
            elif isinstance(v, dict):
                if not v:
                    truncated[k] = {}
                else:
                    truncated[k] = {"...": "..."}
            else:
                truncated[k] = v
        return truncated
    return data

def print_template_picker():
    console.print("\n[bold cyan]Data collection complete! Choose your resume template:[/bold cyan]")
    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("No", style="dim", width=4)
    table.add_column("Template Name", style="bold")
    table.add_column("Style Description")
    table.add_column("ATS Score", justify="right")
    
    templates = [
        ("1", "Sovereign Executive", "Minimalist, architectural whitespace, navy ink", "98/100")
    ]
    
    for row in templates:
        table.add_row(*row)
        
    console.print(table)
    
    choice = IntPrompt.ask("Select a template", choices=[1])
    
    template_map = {
        1: "Sovereign Executive"
    }
    
    return template_map[choice]

@click.command()
def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        console.print("[bold red]ERROR: ANTHROPIC_API_KEY environment variable not set.[/bold red]")
        sys.exit(1)
        
    client = anthropic.Anthropic(api_key=api_key)
    messages = []
    
    current_system_prompt = SYSTEM_PROMPT.strip() + "\n\n" + LIVE_PREVIEW_INSTRUCTION.strip()
    
    student_mode_activated = False
    student_keywords = ["student", "college", "university", "no job", "fresher", "no experience", "just graduated", "final year"]
    
    console.print(Panel.fit("[bold cyan]Welcome to Cloak[/bold cyan]\nLet's build your standout resume block by block.", border_style="cyan"))
    
    final_json = None
    partial_json = None
    
    try:
        while True:
            user_input = console.input("\n[bold green]You:[/bold green] ")
            if user_input.strip().lower() in ['exit', 'quit']:
                console.print("[bold yellow]Exiting chat...[/bold yellow]")
                sys.exit(0)
                
            # Dynamic switch to student mode
            if not student_mode_activated:
                if any(kw in user_input.lower() for kw in student_keywords):
                    student_mode_activated = True
                    current_system_prompt += "\n\n" + STUDENT_RULES.strip()
                    console.print("[dim italic]✨ Detected student context. Switched to Student Mode focusing on Projects over Experience.[/dim italic]")
                    
            messages.append({"role": "user", "content": user_input})
            
            with console.status("[bold blue]Cloak is thinking...[/bold blue]", spinner="dots"):
                response = client.messages.create(
                    model="claude-sonnet-4-20250514", # Using user-requested explicit model tag
                    max_tokens=4000,
                    system=current_system_prompt,
                    messages=messages,
                    temperature=0.7
                )
                
            ai_msg = response.content[0].text
            messages.append({"role": "assistant", "content": ai_msg})
            
            if "CLOAK_JSON_START" in ai_msg and "CLOAK_JSON_END" in ai_msg:
                match = re.search(r'CLOAK_JSON_START(.*?)CLOAK_JSON_END', ai_msg, re.DOTALL)
                if match:
                    final_json_str = match.group(1).strip()
                    try:
                        final_json = json.loads(final_json_str)
                        break 
                    except json.JSONDecodeError:
                        console.print("[bold red]Failed to decode the final JSON.[/bold red]")
                        console.print(final_json_str)
                        sys.exit(1)
            
            preview_match = re.search(r'<live_preview>(.*?)</live_preview>', ai_msg, re.DOTALL)
            clean_msg = re.sub(r'<live_preview>.*?</live_preview>', '', ai_msg, flags=re.DOTALL).strip()
            
            console.print("\n[bold magenta]Cloak:[/bold magenta]")
            console.print(Markdown(clean_msg))
            
            if preview_match:
                preview_json_str = preview_match.group(1).strip()
                try:
                    preview_data = json.loads(preview_json_str)
                    partial_json = preview_data
                    
                    collapsed = truncate_json(preview_data)
                    filtered = {k: v for k, v in collapsed.items() if v}
                    
                    if filtered:
                        syntax = Syntax(json.dumps(filtered, indent=2), "json", theme="monokai", word_wrap=True)
                        console.print(Panel(syntax, title="[yellow]Live JSON Preview[/yellow]", expand=False, border_style="yellow"))
                except json.JSONDecodeError:
                    pass
                    
    except KeyboardInterrupt:
        console.print("\n\n[bold yellow]Chat interrupted by user.[/bold yellow]")
        if partial_json:
            with open("user_data.partial.json", "w") as f:
                json.dump(partial_json, f, indent=2)
            console.print("[dim]Saved partial data gathered so far to user_data.partial.json[/dim]")
        sys.exit(0)
        
    if final_json:
        template_name = print_template_picker()
        final_json["template"] = template_name
        
        with open("user_data.json", "w") as f:
            json.dump(final_json, f, indent=2)
            
        console.print("\n")
        console.print(Panel("[bold green]Success! Resume data saved to user_data.json.[/bold green]", border_style="green"))
        console.print("[bold cyan]Next step:[/bold cyan] Run the following command:")
        console.print("  [bold white]python resume_terminal.py generate --data user_data.json[/bold white]\n")

if __name__ == "__main__":
    main()
