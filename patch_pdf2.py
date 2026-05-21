import sys

with open("resume_terminal.py", "r", encoding="utf-8") as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if line.startswith("def build_pdf"):
        start_idx = i
    if line.startswith("@click.group()"):
        end_idx = i
        break

new_build_pdf = """def build_pdf(user_data: dict, output_path: str, ats_report: dict | None = None):
    \"\"\"Render the resume PDF using Stitch design tokens.\"\"\"
    apply_template(user_data.get("template", "Sovereign Executive"))
    
    S = STITCH_TOKENS["spacing"]
    styles = build_styles()
    P = STITCH_TOKENS["palette"]
    R = STITCH_TOKENS["rules"]

    personal = user_data.get("personal") or user_data.get("personal_info") or user_data.get("personalInfo") or user_data.get("Personal Info") or user_data
    name = personal.get("name") or user_data.get("name", "Candidate")

    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        topMargin=S["margin_top"] * inch,
        bottomMargin=S["margin_bottom"] * inch,
        leftMargin=S["margin_left"] * inch,
        rightMargin=S["margin_right"] * inch,
        title=f"Resume - {name}",
        author=name,
        subject="Professional Resume",
    )

    story = []

    name_str = name.upper() if R.get("header_uppercase") else name
    story.append(Paragraph(name_str, styles["name"]))
    
    title_str = personal.get('title', '')
    if title_str and R.get("header_uppercase"): title_str = title_str.upper()
    
    if not R.get("single_column"):
        # For Creative Bold, show title below name without location
        story.append(Paragraph(title_str, styles["tagline"]))
        story.append(Spacer(1, 4))
        story.append(HRFlowable(width="100%", thickness=1.5, color=HexColor(P["ink"]), spaceBefore=2, spaceAfter=8))
        
        # Build contact grid
        contact_parts = []
        if personal.get("phone"): contact_parts.append(f"<b>P</b> {personal.get('phone')}")
        if personal.get("email"): contact_parts.append(f"<b>E</b> {personal.get('email')}")
        if personal.get("location"): contact_parts.append(f"<b>A</b> {personal.get('location')}")
        if personal.get("linkedin"): contact_parts.append(f"<b>W</b> {personal.get('linkedin')}")
        
        contact_line = " &nbsp;&nbsp;&nbsp;&nbsp; ".join(contact_parts)
        story.append(Paragraph(contact_line, styles["contact"]))
        story.append(Spacer(1, 6))
        story.append(HRFlowable(width="100%", thickness=2, color=HexColor("#C4D6E0"), spaceBefore=2, spaceAfter=12))
    else:
        story.append(Paragraph(
            f"{title_str}  ·  {personal.get('location', '')}",
            styles["tagline"]
        ))
        contact_line = "  ·  ".join(filter(None, [
            personal.get("email", ""),
            personal.get("phone", ""),
            personal.get("linkedin", ""),
            personal.get("github", ""),
        ]))
        story.append(Paragraph(contact_line, styles["contact"]))
        story.append(HRFlowable(
            width="100%", thickness=1,
            color=HexColor(P["ink"]),
            spaceBefore=6, spaceAfter=0,
        ))

    left_column = []
    right_column = []
    
    def add_to_flow(block, target="left"):
        if R.get("single_column"):
            story.append(KeepTogether(block))
        else:
            if target == "left":
                left_column.extend(block)
            else:
                right_column.extend(block)

    if user_data.get("summary"):
        summary_block = []
        section_header(summary_block, "Objective" if not R.get("single_column") else "Professional Summary", styles)
        summary_block.append(Paragraph(user_data["summary"], styles["body"]))
        summary_block.append(Spacer(1, 8))
        add_to_flow(summary_block, "left")

    if user_data.get("projects"):
        for i, proj in enumerate(user_data["projects"]):
            entry_block = []
            if i == 0:
                section_header(entry_block, "Projects", styles)

            link_str = proj.get("link", "")
            tbl = Table(
                [[Paragraph(proj["name"], styles["company"]),
                  Paragraph(link_str, styles["date_line"])]],
                colWidths=["60%", "40%"],
                style=TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                ])
            )
            entry_block.append(tbl)
            if proj.get("tech"):
                entry_block.append(Paragraph(f"<b>Tech:</b> {proj['tech']}", styles["job_title"]))
            for bullet in proj.get("bullets", []):
                entry_block.append(Paragraph(f"• {bullet}", styles["bullet"]))
            entry_block.append(Spacer(1, S["item_gap"]))
            add_to_flow(entry_block, "left")

    if user_data.get("experience"):
        for i, exp in enumerate(user_data["experience"]):
            entry_block = []
            if i == 0:
                section_header(entry_block, "Experience", styles)
            end_str = exp.get("end", "Present")
            date_str = f"{exp.get('start', '')} - {end_str}"
            loc_str  = exp.get("location", "")

            tbl = Table(
                [[Paragraph(exp["company"], styles["company"]),
                  Paragraph(date_str, styles["date_line"])]],
                colWidths=["70%", "30%"],
                style=TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                ])
            )
            entry_block.append(tbl)
            title_loc = exp["title"]
            if loc_str:
                title_loc += f"  •  {loc_str}"
            entry_block.append(Paragraph(title_loc, styles["job_title"]))
            for bullet in exp.get("bullets", []):
                entry_block.append(Paragraph(f"• {bullet}", styles["bullet"]))
            entry_block.append(Spacer(1, S["item_gap"]))
            add_to_flow(entry_block, "left")

    if user_data.get("education"):
        edu_block = []
        section_header(edu_block, "Education", styles)
        for edu in user_data["education"]:
            degree_field = edu["degree"]
            if edu.get("field"):
                degree_field += f", {edu['field']}"
            
            if R.get("single_column"):
                tbl = Table(
                    [[Paragraph(edu["institution"], styles["company"]),
                      Paragraph(edu.get("year", ""), styles["date_line"])]],
                    colWidths=["70%", "30%"],
                    style=TableStyle([
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),("RIGHTPADDING", (0, 0), (-1, -1), 0),
                        ("TOPPADDING", (0, 0), (-1, -1), 0),("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                    ])
                )
                edu_block.append(tbl)
            else:
                edu_block.append(Paragraph(edu.get("year", ""), styles["date_line"]))
                edu_block.append(Paragraph(edu["institution"], styles["company"]))
                
            edu_block.append(Paragraph(degree_field, styles["job_title"]))
            edu_block.append(Spacer(1, S["item_gap"]))
        add_to_flow(edu_block, "right")

    if user_data.get("skills"):
        skills_block = []
        section_header(skills_block, "Key Skills" if not R.get("single_column") else "Skills", styles)
        for category, skill_list in user_data["skills"].items():
            skills_str = " • ".join(skill_list)
            if R.get("single_column"):
                skills_block.append(Paragraph(f'<b>{category}:</b>  {skills_str}', styles["skills_val"]))
            else:
                skills_block.append(Paragraph(f'• {category}: {skills_str}', styles["bullet"]))
        add_to_flow(skills_block, "right")

    if user_data.get("certifications"):
        cert_block = []
        section_header(cert_block, "Certifications", styles)
        for cert in user_data["certifications"]:
            if R.get("single_column"):
                tbl = Table(
                    [[Paragraph(cert["name"], styles["cert_name"]),
                      Paragraph(cert.get("year", ""), styles["date_line"])]],
                    colWidths=["70%", "30%"],
                    style=TableStyle([
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),("RIGHTPADDING", (0, 0), (-1, -1), 0),
                        ("TOPPADDING", (0, 0), (-1, -1), 0),("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                    ])
                )
                cert_block.append(tbl)
            else:
                cert_block.append(Paragraph(cert.get("year", ""), styles["date_line"]))
                cert_block.append(Paragraph(cert["name"], styles["cert_name"]))
            cert_block.append(Paragraph(cert.get("issuer", ""), styles["cert_meta"]))
        add_to_flow(cert_block, "right")

    if not R.get("single_column"):
        left_col_width = (letter[0] - S["margin_left"] * inch - S["margin_right"] * inch) * 0.70
        right_col_width = (letter[0] - S["margin_left"] * inch - S["margin_right"] * inch) * 0.30
        
        main_table = Table([[left_column, right_column]], colWidths=[left_col_width, right_col_width])
        main_table.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('BACKGROUND', (1,0), (1,0), HexColor("#C4D6E0")),
            ('LEFTPADDING', (1,0), (1,0), 12),
            ('RIGHTPADDING', (1,0), (1,0), 12),
            ('TOPPADDING', (1,0), (1,0), 12),
            ('BOTTOMPADDING', (1,0), (1,0), 12),
            ('LEFTPADDING', (0,0), (0,0), 0),
            ('RIGHTPADDING', (0,0), (0,0), 12),
            ('TOPPADDING', (0,0), (0,0), 0),
            ('BOTTOMPADDING', (0,0), (0,0), 0),
        ]))
        story.append(main_table)

    doc.build(story, onFirstPage=draw_background, onLaterPages=draw_background)

"""

new_code = "".join(lines[:start_idx]) + new_build_pdf + "".join(lines[end_idx:])

old_apply = '    if template_name == "Modern Tech":'
new_apply = """    if template_name == "Creative Bold":
        P["page"] = "#FFFFFF"
        P["ink"] = "#1A2639"
        P["ink_light"] = "#444444"
        P["ink_muted"] = "#444444"
        P["rule"] = "#1A2639"
        
        T["font_primary"] = "Helvetica"
        T["font_bold"] = "Helvetica-Bold"
        T["font_oblique"] = "Helvetica-Oblique"
        
        R["header_alignment"] = TA_CENTER
        R["header_uppercase"] = True
        R["contact_font"] = "Helvetica"
        R["single_column"] = False
    elif template_name == "Modern Tech":"""

new_code = new_code.replace(old_apply, new_apply)

with open("resume_terminal.py", "w", encoding="utf-8") as f:
    f.write(new_code)
print("Updated successfully")
