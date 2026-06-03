/**
 * ResumeRenderer — Modern Vanguard HTML Template
 * Generates a complete HTML resume using rv- prefixed classes
 * to avoid any collision with the main app's style.css.
 */

function renderHTMLResume(userData, templateId) {
  const container = document.getElementById("print-container");
  if (!container) return;

  if (templateId === "Modern Vanguard") {
    container.innerHTML = buildVanguardHTML(userData);
  } else {
    container.innerHTML = "";
  }
}

function _esc(str) {
  if (!str) return "";
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function buildVanguardHTML(data) {
  const p = data.personal || data.personal_info || data.personalInfo || {};

  // ── Contact line ──
  const contactParts = [];
  if (p.email) contactParts.push(`<span>${_esc(p.email)}</span>`);
  if (p.phone) contactParts.push(`<span>${_esc(p.phone)}</span>`);
  if (p.location) contactParts.push(`<span>${_esc(p.location)}</span>`);
  if (p.linkedin) contactParts.push(`<span>${_esc(p.linkedin)}</span>`);
  if (p.github) contactParts.push(`<span>${_esc(p.github)}</span>`);

  // ── Photo ──
  let photoHTML = "";
  if (p.photo_url) {
    photoHTML = `<img src="${_esc(p.photo_url)}" class="rv-photo" alt="">`;
  }

  // ── LEFT COLUMN ──
  let left = "";

  // Summary / Objective
  if (data.summary) {
    left += `
      <div class="rv-section">
        <div class="rv-section-title">Objective</div>
        <div class="rv-entry-body">${_esc(data.summary)}</div>
      </div>`;
  }

  // Experience
  if (data.experience && data.experience.length) {
    let entries = data.experience.map(exp => {
      const bullets = (exp.bullets || [])
        .map(b => `<li>${_esc(b)}</li>`).join("");
      const loc = exp.location ? ` &bull; ${_esc(exp.location)}` : "";
      return `
        <div class="rv-entry">
          <div class="rv-entry-row">
            <div class="rv-entry-title">${_esc(exp.company)}</div>
            <div class="rv-entry-date">${_esc(exp.start)} – ${_esc(exp.end || "Present")}</div>
          </div>
          <div class="rv-entry-subtitle">${_esc(exp.title || exp.role)}${loc}</div>
          ${bullets ? `<ul>${bullets}</ul>` : ""}
        </div>`;
    }).join("");

    left += `
      <div class="rv-section">
        <div class="rv-section-title">Experience</div>
        ${entries}
      </div>`;
  }

  // Projects
  if (data.projects && data.projects.length) {
    let entries = data.projects.map(proj => {
      const bullets = (proj.bullets || [])
        .map(b => `<li>${_esc(b)}</li>`).join("");
      return `
        <div class="rv-entry">
          <div class="rv-entry-row">
            <div class="rv-entry-title">${_esc(proj.name)}</div>
            <div class="rv-entry-date">${_esc(proj.link)}</div>
          </div>
          ${proj.tech ? `<div class="rv-entry-subtitle">Tech: ${_esc(proj.tech)}</div>` : ""}
          ${bullets ? `<ul>${bullets}</ul>` : ""}
        </div>`;
    }).join("");

    left += `
      <div class="rv-section">
        <div class="rv-section-title">Projects</div>
        ${entries}
      </div>`;
  }



  // ── RIGHT COLUMN ──
  let right = "";

  // Education
  if (data.education && data.education.length) {
    let eduEntries = data.education.map(edu => {
      const degree = [edu.degree, edu.field].filter(Boolean).map(_esc).join(", ");
      return `
        <div class="rv-edu-entry">
          <div class="rv-edu-year">${_esc(edu.year)}</div>
          <hr class="rv-edu-divider">
          <div class="rv-edu-inst">${_esc(edu.institution)}</div>
          ${degree ? `<div class="rv-edu-degree">${degree}</div>` : ""}
          ${edu.location ? `<div class="rv-entry-body" style="margin-top:2pt">${_esc(edu.location)}</div>` : ""}
        </div>`;
    }).join("");

    right += `
      <div class="rv-section">
        <div class="rv-section-title">Education</div>
        ${eduEntries}
      </div>`;
  }

  // Skills
  if (data.skills) {
    let skillsHTML = "";
    if (Array.isArray(data.skills)) {
      data.skills.forEach(sk => {
        if (typeof sk === "object") {
          const cat = sk.category || sk.name || "Skills";
          const items = sk.items || sk.skills || [];
          const joined = Array.isArray(items) ? items.map(_esc).join(" &bull; ") : _esc(items);
          skillsHTML += `
            <div class="rv-skill-group">
              <div class="rv-skill-cat">&bull; ${_esc(cat)}:</div>
              <div class="rv-skill-items">${joined}</div>
            </div>`;
        } else if (typeof sk === "string") {
          skillsHTML += `<div class="rv-skill-items">&bull; ${_esc(sk)}</div>`;
        }
      });
    } else {
      for (const [cat, items] of Object.entries(data.skills)) {
        const joined = Array.isArray(items) ? items.map(_esc).join(" &bull; ") : _esc(items);
        skillsHTML += `
          <div class="rv-skill-group">
            <div class="rv-skill-cat">&bull; ${_esc(cat)}:</div>
            <div class="rv-skill-items">${joined}</div>
          </div>`;
      }
    }

    right += `
      <div class="rv-section">
        <div class="rv-section-title">Key Skills</div>
        ${skillsHTML}
      </div>`;
  }

  // Certifications
  if (data.certifications && data.certifications.length) {
    let certEntries = data.certifications.map(c => `
      <div class="rv-cert-entry">
        <div class="rv-entry-row">
          <div class="rv-cert-name">${_esc(c.name)}</div>
          <div class="rv-entry-date">${_esc(c.year)}</div>
        </div>
        ${c.issuer ? `<div class="rv-cert-meta">${_esc(c.issuer)}</div>` : ""}
      </div>`
    ).join("");

    right += `
      <div class="rv-section">
        <div class="rv-section-title">Certifications</div>
        ${certEntries}
      </div>`;
  }

  // Custom sections (anything not in standard keys) → right column
  const skipKeys = new Set([
    "personal", "personal_info", "personalInfo", "Personal Info",
    "template", "name", "summary", "experience", "projects",
    "education", "skills", "certifications"
  ]);
  for (const key of Object.keys(data)) {
    if (skipKeys.has(key)) continue;
    const sectionData = data[key];
    if (!sectionData) continue;

    let content = "";
    const title = key.replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    if (Array.isArray(sectionData)) {
      sectionData.forEach(item => {
        if (typeof item === "object" && item !== null) {
          const itemName = _esc(item.name || item.title || "");
          const itemDate = _esc(item.year || item.date || "");
          const subtitle = _esc(item.subtitle || item.issuer || item.organization || item.description || "");
          const bullets = (item.bullets || []).map(b => `<li>${_esc(b)}</li>`).join("");
          content += `
            <div class="rv-entry">
              ${itemName || itemDate ? `
                <div class="rv-entry-row">
                  <div class="rv-entry-title">${itemName}</div>
                  <div class="rv-entry-date">${itemDate}</div>
                </div>` : ""}
              ${subtitle ? `<div class="rv-entry-subtitle">${subtitle}</div>` : ""}
              ${bullets ? `<ul>${bullets}</ul>` : ""}
            </div>`;
        } else if (typeof item === "string") {
          content += `<div class="rv-entry-body">&bull; ${_esc(item)}</div>`;
        }
      });
    } else if (typeof sectionData === "string") {
      content = `<div class="rv-entry-body">${_esc(sectionData)}</div>`;
    }

    if (content) {
      right += `
        <div class="rv-section">
          <div class="rv-section-title">${_esc(title)}</div>
          ${content}
        </div>`;
    }
  }

  // ── Assemble page ──
  return `
    <div class="rv-page">
      <div class="rv-header">
        ${photoHTML}
        <div class="rv-header-text">
          <div class="rv-name">${_esc(p.name || "Candidate Name")}</div>
          <div class="rv-tagline">${_esc(p.title || "")}</div>
          <div class="rv-contact">${contactParts.join("")}</div>
        </div>
      </div>
      <div class="rv-grid">
        <div class="rv-col-left">${left}</div>
        <div class="rv-col-right">${right}</div>
      </div>
    </div>`;
}
