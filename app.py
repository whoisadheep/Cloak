"""
Cloak Web Server
Flask API that bridges the existing CLI resume builder to a web frontend.
Uses Google Gemini API for chat, reuses PDF generation from resume_terminal.py.
"""

import os
import sys
import json
import re
import tempfile
from pathlib import Path
import PyPDF2

from flask import (
    Flask, request, Response, jsonify,
    render_template, send_file
)
from google import genai
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Import existing backend modules
from cloak_chat import SYSTEM_PROMPT, STUDENT_RULES, LIVE_PREVIEW_INSTRUCTION
from resume_terminal import build_pdf, analyze_ats_gaps

app = Flask(__name__)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

STUDENT_KEYWORDS = [
    "student", "college", "university", "no job", "fresher",
    "no experience", "just graduated", "final year"
]


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/chat", methods=["POST"])
def chat():
    """Stream chat responses from Gemini using the Cloak system prompt."""
    data = request.json
    messages = data.get("messages", [])
    student_mode = data.get("student_mode", False)
    
    # Detect student keywords immediately from history
    for msg in reversed(messages):
        if msg["role"] == "user":
            if any(kw in msg["content"].lower() for kw in STUDENT_KEYWORDS):
                student_mode = True
            break

    system_instruction = SYSTEM_PROMPT.strip() + "\n\n" + LIVE_PREVIEW_INSTRUCTION.strip()
    if student_mode:
        system_instruction += "\n\n" + STUDENT_RULES.strip()

    client = genai.Client(api_key=GEMINI_API_KEY)

    # Trim to last 6 messages to reduce token usage & avoid rate limits
    trimmed = messages[-6:] if len(messages) > 6 else messages

    # Build Gemini contents: conversation history
    gemini_contents = []
    for msg in trimmed:
        role = "user" if msg["role"] == "user" else "model"
        gemini_contents.append({"role": role, "parts": [{"text": msg["content"]}]})

    def generate():
        full_response = ""
        try:
            stream = client.models.generate_content_stream(
                model="gemini-3.1-flash-lite",
                contents=gemini_contents,
                config={
                    "system_instruction": system_instruction,
                    "temperature": 0.7,
                    "max_output_tokens": 4000,
                },
            )

            for chunk in stream:
                if chunk.text:
                    full_response += chunk.text
                    yield f"data: {json.dumps({'type': 'text', 'content': chunk.text})}\n\n"

            # Extract final JSON if conversation is complete
            final_json = None
            if "CLOAK_JSON_START" in full_response and "CLOAK_JSON_END" in full_response:
                match = re.search(
                    r"CLOAK_JSON_START(.*?)CLOAK_JSON_END", full_response, re.DOTALL
                )
                if match:
                    try:
                        final_json = json.loads(match.group(1).strip())
                    except json.JSONDecodeError:
                        pass

            # Extract live preview data
            live_preview = None
            preview_match = re.search(
                r"<live_preview>(.*?)</live_preview>", full_response, re.DOTALL
            )
            if preview_match:
                try:
                    live_preview = json.loads(preview_match.group(1).strip())
                except json.JSONDecodeError:
                    pass

            # Detect student mode from latest user message
            detected_student = False
            for msg in reversed(messages):
                if msg["role"] == "user":
                    if any(kw in msg["content"].lower() for kw in STUDENT_KEYWORDS):
                        detected_student = True
                    break

            # Clean display text (strip live_preview tags)
            clean_text = re.sub(
                r"<live_preview>.*?</live_preview>", "", full_response, flags=re.DOTALL
            ).strip()
            clean_text = re.sub(
                r"CLOAK_JSON_START.*?CLOAK_JSON_END", "", clean_text, flags=re.DOTALL
            ).strip()

            yield f"data: {json.dumps({'type': 'done', 'final_json': final_json, 'live_preview': live_preview, 'student_detected': detected_student, 'clean_text': clean_text})}\n\n"

        except Exception as e:
            error_str = str(e).lower()
            print(f"[CLOAK ERROR] {e}", flush=True)  # Log raw error
            if "api_key" in error_str or "401" in error_str or "permission" in error_str:
                friendly = "Invalid API key. Please check your GEMINI_API_KEY in .env."
            elif "rate_limit" in error_str or "429" in error_str or "quota" in error_str or "resource_exhausted" in error_str:
                friendly = "API rate limit reached. Please wait a minute and try again."
            elif "timeout" in error_str or "deadline" in error_str:
                friendly = "Request timed out. Please try again."
            elif "connection" in error_str or "network" in error_str:
                friendly = "Could not reach the AI service. Check your connection."
            else:
                friendly = f"Something went wrong: {str(e)[:120]}"
            yield f"data: {json.dumps({'type': 'error', 'content': friendly})}\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/upload", methods=["POST"])
def upload_file():
    """Extract text from an uploaded PDF or TXT file."""
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
    
    try:
        text = ""
        if file.filename.lower().endswith('.pdf'):
            reader = PyPDF2.PdfReader(file)
            for page in reader.pages:
                text += page.extract_text() + "\n"
        else:
            text = file.read().decode('utf-8', errors='ignore')
            
        if not text.strip():
            return jsonify({"error": "Could not extract text from file"}), 400
            
        return jsonify({"text": text.strip()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/generate", methods=["POST"])
def generate_pdf():
    """Generate a PDF resume from user data and return it as a download."""
    data = request.json
    user_data = data.get("user_data", {})
    template = data.get("template", "Sovereign Executive")

    user_data["template"] = template

    name = user_data.get("personal", {}).get("name", "resume")
    slug = re.sub(r"[^a-zA-Z0-9]", "_", name).lower()

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        build_pdf(user_data, tmp_path)
        with open(tmp_path, "rb") as f:
            pdf_bytes = f.read()
        return Response(
            pdf_bytes,
            mimetype="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{slug}_resume.pdf"'
            },
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.route("/api/ats", methods=["POST"])
def ats_analysis():
    """Run ATS gap analysis between user data and a job description."""
    data = request.json
    user_data = data.get("user_data", {})
    jd_text = data.get("job_description", "")

    if not jd_text.strip():
        return jsonify({"error": "No job description provided."}), 400

    report = analyze_ats_gaps(user_data, jd_text)
    return jsonify(report)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
