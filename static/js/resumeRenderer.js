/**
 * ResumeRenderer
 * Generates an HTML DOM structure for the resume and injects it into the print container.
 */

function renderHTMLResume(userData, templateId) {
  const container = document.getElementById("print-container");
  if (!container) return;
  
  if (templateId === "Modern Vanguard") {
    container.innerHTML = generateVanguard(userData);
  } else {
    // Fallback or other templates can be added here
    container.innerHTML = "";
  }
}

function escapeHTML(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.innerText = str;
  return div.innerHTML;
}

function generateVanguard(data) {
  const personal = data.personal || data.personal_info || data.personalInfo || {};
  
  // Header HTML
  let contactHtml = "";
  if (personal.email) contactHtml += `<span>${escapeHTML(personal.email)}</span>`;
  if (personal.phone) contactHtml += `<span>${escapeHTML(personal.phone)}</span>`;
  if (personal.location) contactHtml += `<span>${escapeHTML(personal.location)}</span>`;
  if (personal.linkedin) contactHtml += `<span>${escapeHTML(personal.linkedin)}</span>`;
  if (personal.github) contactHtml += `<span>${escapeHTML(personal.github)}</span>`;
  
  let headerPhotoHtml = "";
  if (personal.photo_url) {
    headerPhotoHtml = `<img src="${escapeHTML(personal.photo_url)}" class="header-photo" alt="Profile Photo">`;
  }

  // Generate Left Column (Experience, Projects)
  let leftColumnHtml = "";
  if (data.summary) {
    leftColumnHtml += `
      <div class="section">
        <div class="section-title">Objective</div>
        <div class="entry-body">${escapeHTML(data.summary)}</div>
      </div>
    `;
  }

  if (data.experience && data.experience.length > 0) {
    let expEntries = data.experience.map(exp => {
      let bullets = "";
      if (exp.bullets && exp.bullets.length > 0) {
        bullets = `<ul>${exp.bullets.map(b => `<li>${escapeHTML(b)}</li>`).join("")}</ul>`;
      }
      return `
        <div class="entry">
          <div class="entry-header">
            <div class="entry-title">${escapeHTML(exp.company)}</div>
            <div class="entry-date">${escapeHTML(exp.start)} - ${escapeHTML(exp.end || "Present")}</div>
          </div>
          <div class="entry-subtitle">${escapeHTML(exp.title || exp.role)}${exp.location ? ` &bull; ${escapeHTML(exp.location)}` : ''}</div>
          <div class="entry-body">${bullets}</div>
        </div>
      `;
    }).join("");
    leftColumnHtml += `
      <div class="section">
        <div class="section-title">Experience</div>
        ${expEntries}
      </div>
    `;
  }

  if (data.projects && data.projects.length > 0) {
    let projEntries = data.projects.map(proj => {
      let bullets = "";
      if (proj.bullets && proj.bullets.length > 0) {
        bullets = `<ul>${proj.bullets.map(b => `<li>${escapeHTML(b)}</li>`).join("")}</ul>`;
      }
      return `
        <div class="entry">
          <div class="entry-header">
            <div class="entry-title">${escapeHTML(proj.name)}</div>
            <div class="entry-date">${escapeHTML(proj.link)}</div>
          </div>
          ${proj.tech ? `<div class="entry-subtitle">Tech: ${escapeHTML(proj.tech)}</div>` : ''}
          <div class="entry-body">${bullets}</div>
        </div>
      `;
    }).join("");
    leftColumnHtml += `
      <div class="section">
        <div class="section-title">Projects</div>
        ${projEntries}
      </div>
    `;
  }

  // Generate Right Column (Education, Skills, Certs)
  let rightColumnHtml = "";
  
  if (data.education && data.education.length > 0) {
    let eduEntries = data.education.map(edu => {
      let degree = [];
      if (edu.degree) degree.push(escapeHTML(edu.degree));
      if (edu.field) degree.push(escapeHTML(edu.field));
      
      return `
        <div class="entry">
          <div class="entry-date" style="text-align: right; margin-bottom: 2px;">${escapeHTML(edu.year)}</div>
          <div style="border-bottom: 0.5px solid #A5C5B5; margin-bottom: 4px;"></div>
          <div class="entry-title">${escapeHTML(edu.institution)}</div>
          <div class="entry-subtitle" style="margin-top: 2px;">${degree.join(", ")}</div>
          ${edu.location ? `<div class="entry-body">${escapeHTML(edu.location)}</div>` : ''}
        </div>
      `;
    }).join("");
    rightColumnHtml += `
      <div class="section">
        <div class="section-title">Education</div>
        ${eduEntries}
      </div>
    `;
  }

  if (data.skills) {
    let skillsHtml = "";
    let skillsData = data.skills;
    
    // Handle skills as dict or array
    if (!Array.isArray(skillsData)) {
      for (const [category, items] of Object.entries(skillsData)) {
        skillsHtml += `
          <div class="skills-category">
            <div class="skills-category-title">&bull; ${escapeHTML(category)}:</div>
            <div class="skills-list">${Array.isArray(items) ? items.map(escapeHTML).join(" &bull; ") : escapeHTML(items)}</div>
          </div>
        `;
      }
    } else {
      skillsData.forEach(sk => {
        if (typeof sk === "object") {
          let cat = sk.category || sk.name || "Skills";
          let items = sk.items || sk.skills || [];
          let itemsStr = Array.isArray(items) ? items.map(escapeHTML).join(" &bull; ") : escapeHTML(items);
          skillsHtml += `
            <div class="skills-category">
              <div class="skills-category-title">&bull; ${escapeHTML(cat)}:</div>
              <div class="skills-list">${itemsStr}</div>
            </div>
          `;
        } else if (typeof sk === "string") {
          skillsHtml += `<div class="skills-list">&bull; ${escapeHTML(sk)}</div>`;
        }
      });
    }
    
    rightColumnHtml += `
      <div class="section">
        <div class="section-title">Key Skills</div>
        ${skillsHtml}
      </div>
    `;
  }
  
  if (data.certifications && data.certifications.length > 0) {
    let certEntries = data.certifications.map(cert => {
      return `
        <div class="entry">
          <div class="entry-date">${escapeHTML(cert.year)}</div>
          <div class="entry-title">${escapeHTML(cert.name)}</div>
          <div class="entry-body">${escapeHTML(cert.issuer)}</div>
        </div>
      `;
    }).join("");
    rightColumnHtml += `
      <div class="section">
        <div class="section-title">Certifications</div>
        ${certEntries}
      </div>
    `;
  }

  // Combine Everything
  return `
    <div class="resume-vanguard">
      <div class="header">
        ${headerPhotoHtml}
        <div class="header-content">
          <h1>${escapeHTML(personal.name || "Candidate Name")}</h1>
          <div class="tagline">${escapeHTML(personal.title || "")}</div>
          <div class="contact-info">${contactHtml}</div>
        </div>
      </div>
      
      <div class="resume-grid">
        <div class="column-left">
          ${leftColumnHtml}
        </div>
        <div class="column-right">
          ${rightColumnHtml}
        </div>
      </div>
    </div>
  `;
}
