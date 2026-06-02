/**
 * Cloak — Frontend Application
 * Manages view routing, chat interaction with streaming,
 * live preview, template selection, and PDF download.
 */

(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────
  const RATE_LIMIT_MS = 1500;       // Min 1.5 s between API calls
  const MAX_HISTORY   = 6;          // Only send last N messages to API

  const state = {
    currentView: "landing",
    messages: [],        // { role: 'user'|'assistant', content: string }
    studentMode: false,
    userData: null,       // Final collected JSON
    livePreview: null,    // Partial JSON from live_preview tags
    selectedTemplate: "Sovereign Executive",
    isStreaming: false,
    greetingSent: false,  // Prevent duplicate greeting API calls
    lastRequestTime: 0,   // Timestamp of last API call
    rateLimitCooldown: 0, // Cooldown timer id
  };

  const TEMPLATES = [
    { id: "Sovereign Executive", name: "Sovereign Executive", desc: "Minimalist, architectural whitespace, navy ink.", ats: "98", img: "/static/img/templates/sovereign.png" },
    { id: "Modern Vanguard", name: "Modern Vanguard", desc: "Forest green accents, side-by-side photo layout, visionary feel.", ats: "95", img: "/static/img/templates/vanguard.png" }
  ];

  // ── DOM refs ───────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const views = {
    landing:    $("#view-landing"),
    onboarding: $("#view-onboarding"),
    chat:       $("#view-chat"),
    template:   $("#view-template"),
  };

  const chatMessages  = $("#chat-messages");
  const chatInput     = $("#chat-input");
  const btnSend       = $("#btn-send");
  const typingEl      = $("#typing-indicator");
  const previewBody   = $("#preview-content");
  const previewEmpty  = $("#preview-empty");
  const modeBadge     = $("#chat-mode-badge");
  const templateGrid  = $("#template-grid");
  const atsResult     = $("#ats-result");
  const downloadStatus = $("#download-status");

  // ── State Persistence ──────────────────────────────────────
  function saveState() {
    const toSave = {
      currentView: state.currentView,
      messages: state.messages,
      studentMode: state.studentMode,
      userData: state.userData,
      livePreview: state.livePreview,
      selectedTemplate: state.selectedTemplate,
      greetingSent: state.greetingSent
    };
    localStorage.setItem("cloak_state", JSON.stringify(toSave));
  }

  function loadState() {
    try {
      const saved = localStorage.getItem("cloak_state");
      if (!saved) return false;
      const parsed = JSON.parse(saved);
      
      state.currentView = parsed.currentView || "landing";
      state.messages = parsed.messages || [];
      state.studentMode = !!parsed.studentMode;
      state.userData = parsed.userData || null;
      state.livePreview = parsed.livePreview || null;
      state.selectedTemplate = parsed.selectedTemplate || "Sovereign Executive";
      state.greetingSent = !!parsed.greetingSent;

      if (state.studentMode) {
        modeBadge.textContent = "Student";
        modeBadge.style.background = "rgba(74,222,128,.1)";
        modeBadge.style.color = "#4ADE80";
      }

      chatMessages.innerHTML = "";
      state.messages.forEach(msg => {
        appendMessage(msg.role, msg.content);
      });

      if (state.livePreview) {
        renderPreview(state.livePreview);
      }
      if (state.userData) {
        $("#btn-goto-template").style.display = "block";
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // ── View Management ────────────────────────────────────────
  function showView(name, skipSave = false) {
    Object.values(views).forEach((v) => v.classList.remove("active"));
    views[name].classList.add("active");
    state.currentView = name;

    if (!skipSave) saveState();

    if (name === "chat" && !state.greetingSent) {
      sendInitialGreeting();
    }
  }

  // ── Landing Handlers ──────────────────────────────────────
  $("#btn-start").addEventListener("click", () => {
    renderTemplateGrid("onboarding-template-grid");
    showView("onboarding");
  });

  $("#btn-onboarding-continue").addEventListener("click", () => {
    showView("chat");
    scrollChat();
    sendInitialGreeting();
  });

  $("#btn-upload").addEventListener("click", () => {
    $("#upload-modal").classList.add("visible");
  });

  // ── Score Funnel ──────────────────────────────────────────
  let lastScoredResumeText = "";
  
  $("#btn-score-landing").addEventListener("click", () => {
    $("#file-score").click();
  });

  $("#file-score").addEventListener("change", async () => {
    if (!$("#file-score").files.length) return;
    const file = $("#file-score").files[0];
    
    // Show modal loading state
    $("#score-modal").classList.add("visible");
    $("#score-loading").style.display = "block";
    $("#score-results").style.display = "none";
    
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      // 1. Extract text and check metadata
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("Failed to parse file.");
      const uploadJson = await uploadRes.json();
      lastScoredResumeText = uploadJson.text;
      const isCloak = uploadJson.is_cloak || false;
      
      // 2. Score text
      const scoreRes = await fetch("/api/score", { 
        method: "POST", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: lastScoredResumeText, is_cloak: isCloak })
      });
      if (!scoreRes.ok) throw new Error("Failed to score.");
      const scoreJson = await scoreRes.json();
      
      // 3. Render Results
      $("#score-loading").style.display = "none";
      $("#score-results").style.display = "block";
      
      // Animate score circle (283 is full circumference)
      const prog = 283 - (283 * scoreJson.score) / 100;
      setTimeout(() => {
        $(".score-circle-prog").style.strokeDashoffset = prog;
        $("#score-number-display").innerText = scoreJson.score;
        // color based on score
        let color = "var(--accent)";
        if (scoreJson.score < 60) color = "#FF6B6B";
        else if (scoreJson.score > 85) color = "#4ade80";
        $(".score-circle-prog").style.stroke = color;
        $("#score-number-display").style.color = color;
        $(".score-circle-glow").style.background = color;
      }, 100);
      
      // Render lists
      const prosHtml = scoreJson.pros.map(p => `<li>${p}</li>`).join("");
      const consHtml = scoreJson.cons.map(c => `<li>${c}</li>`).join("");
      $("#score-pros-list").innerHTML = prosHtml;
      $("#score-cons-list").innerHTML = consHtml;
      
      // Update CTA dynamically based on score
      if (scoreJson.score >= 95) {
        $("#score-cta-title").innerText = "Outstanding Score! 🎉";
        $("#score-cta-desc").innerText = "Your resume is already highly optimized. You can still use Cloak's AI to effortlessly tailor it to a specific job description or try our premium designs.";
        $("#btn-rebuild-resume").innerText = "Import to Cloak Anyway";
      } else {
        $("#score-cta-title").innerText = "Want a 95+ score?";
        $("#score-cta-desc").innerText = "Let Cloak rebuild your resume to ATS perfection for free.";
        $("#btn-rebuild-resume").innerText = "Rebuild Resume with AI";
      }
      
    } catch (err) {
      alert("Failed to score resume. Ensure it is a valid PDF.");
      $("#score-modal").classList.remove("visible");
    }
  });

  $("#btn-score-close").addEventListener("click", () => {
    $("#score-modal").classList.remove("visible");
  });

  $("#btn-rebuild-resume").addEventListener("click", () => {
    $("#score-modal").classList.remove("visible");
    showView("chat");
    
    const msg = `Here is my existing resume. Please extract and structure ALL of my information so we can build my new resume. IMPORTANT: Preserve every section from my resume, including any custom sections like awards, publications, volunteer work, languages, etc. Do NOT remove any sections.\n\n${lastScoredResumeText}`;
    appendMessage("user", "Uploaded existing resume to rebuild.");
    state.messages.push({ role: "user", content: msg });
    saveState();
    
    // Trigger AI response
    streamResponse();
  });

  // Edit Modal logic
  const editModal = document.getElementById("edit-modal");
  const editJsonText = document.getElementById("edit-json-text");
  
  document.getElementById("btn-edit-json").addEventListener("click", () => {
    editJsonText.value = JSON.stringify(state.userData, null, 2);
    document.getElementById("edit-preview-content").innerHTML = generatePreviewHtml(state.userData);
    editModal.classList.add("visible");
  });

  editJsonText.addEventListener("input", () => {
    try {
      const data = JSON.parse(editJsonText.value);
      document.getElementById("edit-preview-content").innerHTML = generatePreviewHtml(data);
    } catch (e) {
      // ignore invalid JSON while typing
    }
  });

  document.getElementById("btn-edit-cancel").addEventListener("click", () => {
    editModal.classList.remove("visible");
  });

  document.getElementById("btn-edit-save").addEventListener("click", () => {
    try {
      state.userData = JSON.parse(editJsonText.value);
      saveState();
      editModal.classList.remove("visible");
      renderPreview(state.userData);
      
      const btn = document.getElementById("btn-edit-save");
      const origText = btn.textContent;
      btn.textContent = "Saved!";
      setTimeout(() => { btn.textContent = origText; }, 2000);
    } catch (err) {
      alert("Invalid JSON format. Please fix any syntax errors before saving.");
    }
  });

  $("#btn-modal-close").addEventListener("click", () => {
    $("#upload-modal").classList.remove("visible");
  });
  $("#upload-modal").addEventListener("click", (e) => {
    if (e.target === $("#upload-modal")) {
      $("#upload-modal").classList.remove("visible");
    }
  });

  // ── Donate Modal ──────────────────────────────────────────
  let selectedDonateAmount = "50"; // default

  // ── Donate Amount Chips ──
  document.querySelectorAll(".donate-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".donate-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      selectedDonateAmount = chip.dataset.amount;
    });
  });

  // ── Floating Hearts Canvas ──
  let heartsAnimId = null;
  function initDonateHearts() {
    const canvas = document.getElementById("donate-hearts-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const hearts = [];
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let w, h;

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * DPR;
      canvas.height = h * DPR;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resize();

    function spawnHeart() {
      hearts.push({
        x: Math.random() * w,
        y: h + 20,
        size: Math.random() * 14 + 8,
        speedY: Math.random() * 1.2 + 0.4,
        speedX: (Math.random() - 0.5) * 0.6,
        alpha: Math.random() * 0.35 + 0.1,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.02,
      });
    }

    function drawHeart(x, y, size, rotation, alpha) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      const s = size / 15;
      ctx.moveTo(0, -3 * s);
      ctx.bezierCurveTo(-5 * s, -15 * s, -20 * s, -5 * s, 0, 10 * s);
      ctx.bezierCurveTo(20 * s, -5 * s, 5 * s, -15 * s, 0, -3 * s);
      ctx.closePath();
      ctx.fillStyle = "#FF6B6B";
      ctx.fill();
      ctx.restore();
    }

    let lastSpawn = 0;
    function animate(ts) {
      heartsAnimId = requestAnimationFrame(animate);
      ctx.clearRect(0, 0, w, h);

      if (ts - lastSpawn > 400) {
        spawnHeart();
        lastSpawn = ts;
      }

      for (let i = hearts.length - 1; i >= 0; i--) {
        const heart = hearts[i];
        heart.y -= heart.speedY;
        heart.x += heart.speedX;
        heart.rotation += heart.rotSpeed;
        heart.alpha *= 0.999;
        drawHeart(heart.x, heart.y, heart.size, heart.rotation, heart.alpha);
        if (heart.y < -30 || heart.alpha < 0.01) hearts.splice(i, 1);
      }
    }
    heartsAnimId = requestAnimationFrame(animate);

    window.addEventListener("resize", resize, { passive: true });
  }

  function stopDonateHearts() {
    if (heartsAnimId) { cancelAnimationFrame(heartsAnimId); heartsAnimId = null; }
  }

  // ── Open Donate ──
  const donateBtns = document.querySelectorAll(".btn-donate:not(#btn-proceed-donate)");
  donateBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      $("#donate-step-1").style.display = "block";
      $("#donate-step-2").style.display = "none";
      $("#donate-modal").classList.add("visible");
      initDonateHearts();
    });
  });

  $("#btn-proceed-donate").addEventListener("click", (e) => {
    e.preventDefault();
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    let upiLink = "upi://pay?pa=whoisadheep@okhdfcbank&pn=whoisadheep";
    if (selectedDonateAmount) {
      const formattedAmount = parseFloat(selectedDonateAmount).toFixed(2);
      upiLink += `&am=${formattedAmount}&cu=INR`;
    } else {
      upiLink += "&cu=INR";
    }

    if (isMobile) {
      window.location.href = upiLink;
    } else {
      $("#donate-step-1").style.display = "none";
      
      const qrImg = $("#donate-qr-img");
      const amountText = $("#donate-amount-text");
      
      if (selectedDonateAmount) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiLink)}`;
        amountText.innerText = `Scan to donate ₹${selectedDonateAmount} with any UPI app. Thank you!`;
      } else {
        qrImg.src = "/static/images/upi_qr.png";
        amountText.innerText = `Scan with any UPI app (GPay, PhonePe, Paytm). Thank you!`;
      }
      
      $("#donate-step-2").style.display = "block";
    }
  });

  const closeDonateModal = () => {
    $("#donate-modal").classList.remove("visible");
    stopDonateHearts();
  };

  $("#btn-donate-close").addEventListener("click", closeDonateModal);
  $("#btn-donate-close-2").addEventListener("click", closeDonateModal);
  $("#btn-donate-x").addEventListener("click", closeDonateModal);
  
  $("#donate-modal").addEventListener("click", (e) => {
    if (e.target === $("#donate-modal")) {
      closeDonateModal();
    }
  });

  // File upload
  const uploadZone = $("#upload-zone");
  const fileInput  = $("#file-input");

  uploadZone.addEventListener("click", () => fileInput.click());
  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = "var(--accent)";
    uploadZone.style.background = "var(--accent-dim)";
  });
  uploadZone.addEventListener("dragleave", () => {
    uploadZone.style.borderColor = "";
    uploadZone.style.background = "";
  });
  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = "";
    uploadZone.style.background = "";
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });

  async function handleFile(file) {
    if (file.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          state.userData = data;
          saveState();
          $("#upload-modal").classList.remove("visible");
          renderTemplateGrid("template-grid");
          showView("template");
        } catch {
          alert("Invalid JSON file. Please upload a valid user_data.json.");
        }
      };
      reader.readAsText(file);
    } else {
      $("#upload-modal").classList.remove("visible");
      renderTemplateGrid("onboarding-template-grid");
      showView("onboarding");
      
      const uploadBubble = appendMessage("assistant", "Parsing your existing resume...");
      typingEl.classList.add("visible");
      
      const formData = new FormData();
      formData.append("file", file);
      
      try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        if (!res.ok) throw new Error("Failed to parse file.");
        const json = await res.json();
        
        uploadBubble.remove();
        
        const extractedText = json.text;
        const msg = `Here is my existing resume. Please extract and structure ALL of my information so we can build my new resume. IMPORTANT: Preserve every section from my resume, including any custom sections like awards, publications, volunteer work, languages, etc. Do NOT remove any sections.\n\n${extractedText}`;
        
        appendMessage("user", "Uploaded existing resume.");
        state.messages.push({ role: "user", content: msg });
        saveState();
        
        // Trigger AI response
        streamResponse();
      } catch (err) {
        uploadBubble.remove();
        typingEl.classList.remove("visible");
        appendMessage("assistant", "Sorry, I couldn't read that file. Let's just build it through conversation!");
      }
    }
  }

  // URL Import from Modal
  $("#btn-url-import").addEventListener("click", async () => {
    const url = $("#url-input").value.trim();
    if (!url) return;

    $("#upload-modal").classList.remove("visible");
    showView("chat");
    
    const isProfileUrl = url.includes("linkedin.com") || url.includes("github.com");
    
    appendMessage("user", `Importing from: ${url}`);
    const uploadBubble = appendMessage("assistant", "Scraping profile data...");
    scrollChat();
    typingEl.classList.add("visible");
    
    try {
      const response = await fetch("/api/extract-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url })
      });
      
      const data = await response.json();
      if (!response.ok || !data.text) throw new Error(data.error || "Failed to scrape URL");
      
      uploadBubble.remove();
      
      let payload = "";
      if (isProfileUrl) {
        payload = `The user provided a link to their profile: ${url}. 
Here is the extracted data from their profile:

---
${data.text}
---

Please use this data to bootstrap or update their resume information (experience, education, projects, skills). 
CRITICAL RULES:
1. Extract all relevant professional details and structure them into the resume JSON.
2. Preserve ALL sections including any custom ones (awards, publications, volunteer work, languages, etc.). Do NOT remove any sections.`;
      } else {
        payload = `The user provided a link: ${url}. 
Here is the extracted text:

---
${data.text}
---

Please extract any relevant resume information from this text.`;
      }

      state.messages.push({ role: "user", content: payload });
      saveState();
      
      // Trigger AI response
      streamResponse();
    } catch (err) {
      uploadBubble.remove();
      typingEl.classList.remove("visible");
      appendMessage("assistant", "Sorry, I couldn't extract data from that URL. Some sites block automated access.");
    }
  });

  // ── Chat ──────────────────────────────────────────────────
  $("#btn-chat-back").addEventListener("click", () => showView("landing"));
  $("#btn-template-back").addEventListener("click", () => {
    showView("chat");
  });
  $("#btn-goto-template").addEventListener("click", () => { renderTemplateGrid("template-grid"); showView("template"); });
  
  $("#btn-chat-reset").addEventListener("click", () => {
    if (confirm("Are you sure you want to clear this chat and start completely fresh?")) {
      localStorage.removeItem("cloak_state");
      location.reload();
    }
  });

  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
    btnSend.disabled = !chatInput.value.trim() || state.isStreaming;
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!btnSend.disabled) sendMessage();
    }
  });

  btnSend.addEventListener("click", sendMessage);

  const btnAttach = $("#btn-attach");
  const chatFileInput = $("#chat-file-input");

  if (btnAttach && chatFileInput) {
    btnAttach.addEventListener("click", () => {
      chatFileInput.click();
    });

    chatFileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      chatFileInput.value = ""; // reset

      // Validate type
      if (!file.type.startsWith("image/")) {
        alert("Please upload an image file (JPG, PNG, WEBP).");
        return;
      }

      // Show user bubble with image
      const imgUrlLocal = URL.createObjectURL(file);
      const msgHtml = `<div>I've uploaded my profile photo:</div><img src="${imgUrlLocal}" style="max-width: 150px; border-radius: 8px; margin-top: 8px;">`;
      appendMessage("user", msgHtml, true); // true = render as HTML

      // Upload to server
      const uploadBubble = appendMessage("assistant", "Uploading and processing your photo...");
      scrollChat();
      typingEl.classList.add("visible");

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/upload-image", { method: "POST", body: formData });
        if (!res.ok) throw new Error("Failed to upload image.");
        const json = await res.json();
        
        uploadBubble.remove();
        typingEl.classList.remove("visible");
        
        // Send to AI
        const serverPath = json.url;
        const aiMsg = `I uploaded my profile photo. The file path is ${serverPath}. Please add it to the photo_url field in the personal section of the JSON.`;
        
        state.messages.push({ role: "user", content: aiMsg });
        saveState();
        streamResponse();
        
      } catch (err) {
        uploadBubble.remove();
        typingEl.classList.remove("visible");
        appendMessage("assistant", "Sorry, there was an error uploading your photo.");
        scrollChat();
      }
    });
  }

  function sendInitialGreeting() {
    if (state.greetingSent) return; // Guard: never fire twice
    state.greetingSent = true;

    const greetMsg = "Hi, I'd like to build my resume.";
    appendMessage("user", greetMsg);
    state.messages.push({ role: "user", content: greetMsg });
    saveState();
    streamResponse();
  }

  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || state.isStreaming) return;

    appendMessage("user", text);
    chatInput.value = "";
    chatInput.style.height = "auto";
    btnSend.disabled = true;

    // Detect URL in the text
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    let finalPayload = text;

    if (urlMatch) {
      const url = urlMatch[0];
      state.isStreaming = true; // Block further inputs
      typingEl.classList.add("visible");
      
      try {
        const response = await fetch("/api/extract-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url })
        });
        
        const data = await response.json();
        if (response.ok && data.text) {
          // Check if the URL is a LinkedIn or GitHub profile
          const isProfileUrl = url.includes("linkedin.com") || url.includes("github.com");

          if (isProfileUrl) {
            finalPayload = `The user provided a link to their profile: ${url}. 
Here is the extracted data from their profile:

---
${data.text}
---

Please use this data to bootstrap or update their resume information (experience, education, projects, skills). 
CRITICAL RULES:
1. Extract all relevant professional details and structure them into the resume JSON.
2. If the user provided additional instructions, follow them:
User's message: ${text}`;
          } else {
            finalPayload = `The user provided the following job link: ${url}. 
Here is the extracted job description text:

---
${data.text}
---

Please tailor the existing resume content to match this job description. 
CRITICAL RULES:
1. DO NOT invent fake companies, fake internships, or fake degrees.
2. Only rewrite and enhance the user's EXISTING bullet points and summary to naturally highlight relevant keywords from the job description.
3. If the user provided additional instructions in their message, follow them too:
User's message: ${text}`;
          }
          
          // Show a tiny system message in the chat
          const alert = document.createElement("div");
          alert.style.fontSize = "0.7rem";
          alert.style.color = "var(--success)";
          alert.style.textAlign = "center";
          alert.style.marginBottom = "10px";
          alert.textContent = isProfileUrl 
            ? "✓ Profile data scraped successfully. Updating resume..."
            : "✓ Job description scraped successfully. Tailoring resume...";
          chatMessages.appendChild(alert);
          scrollChat();
        } else {
          console.error("Scraping failed:", data.error);
        }
      } catch (err) {
        console.error("Network error during scraping:", err);
      }
      
      typingEl.classList.remove("visible");
      state.isStreaming = false;
    }

    state.messages.push({ role: "user", content: finalPayload });
    saveState();
    streamResponse();
  }

  function appendMessage(role, content, isHtml = false) {
    const wrapper = document.createElement("div");
    wrapper.className = `msg msg-${role}`;

    const label = document.createElement("div");
    label.className = "msg-label";

    const avatar = document.createElement("span");
    avatar.className = "msg-avatar";
    avatar.textContent = role === "user" ? "Y" : "C";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = role === "user" ? "You" : "Cloak";

    label.appendChild(avatar);
    label.appendChild(nameSpan);

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    if (role === "assistant") {
      bubble.innerHTML = renderMarkdown(content);
    } else if (isHtml) {
      bubble.innerHTML = content;
    } else {
      bubble.textContent = content;
    }

    wrapper.appendChild(label);
    wrapper.appendChild(bubble);
    chatMessages.appendChild(wrapper);
    scrollChat();

    return bubble;
  }

  function scrollChat() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function streamResponse() {
    // ── Rate-limit guard ──────────────────────────────────────
    const now = Date.now();
    const elapsed = now - state.lastRequestTime;
    if (elapsed < RATE_LIMIT_MS) {
      const waitMs = RATE_LIMIT_MS - elapsed;
      // Silently delay instead of showing a scary error card
      await new Promise(r => setTimeout(r, waitMs));
      state.lastRequestTime = Date.now();
    }
    state.lastRequestTime = now;

    state.isStreaming = true;
    btnSend.disabled = true;
    typingEl.classList.add("visible");
    scrollChat();

    // Create assistant bubble for streaming
    const bubble = appendMessage("assistant", "");
    let accumulated = "";

    // Only send the last N messages to keep token usage low
    const trimmedMessages = state.messages.slice(-MAX_HISTORY);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: trimmedMessages,
          student_mode: state.studentMode,
          current_state: state.userData
        }),
      });

      if (!res.ok) {
        let errMsg = "Could not connect to Cloak. Please try again.";
        try { const err = await res.json(); errMsg = err.error || errMsg; } catch {}
        bubble.innerHTML = errorCard(errMsg);
        state.isStreaming = false;
        typingEl.classList.remove("visible");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          let parsed;
          try { parsed = JSON.parse(payload); } catch { continue; }

          if (parsed.type === "text") {
            accumulated += parsed.content;
            bubble.innerHTML = renderMarkdown(stripTags(accumulated));
            scrollChat();
          }

          if (parsed.type === "done") {
            typingEl.classList.remove("visible");

            // Use clean text from server
            if (parsed.clean_text) {
              bubble.innerHTML = renderMarkdown(parsed.clean_text);
            }

            // Update conversation history with full raw response
            state.messages.push({ role: "assistant", content: accumulated });

            // Student mode
            if (parsed.student_detected && !state.studentMode) {
              state.studentMode = true;
              modeBadge.textContent = "Student";
              modeBadge.style.background = "rgba(74,222,128,.1)";
              modeBadge.style.color = "#4ADE80";
            }

            // Live preview
            if (parsed.live_preview) {
              state.livePreview = parsed.live_preview;
              renderPreview(parsed.live_preview);
            }

            // Final JSON — wait for user approval
            if (parsed.final_json) {
              state.userData = parsed.final_json;
              $("#btn-goto-template").style.display = "block";
              
              const finishCard = document.createElement("div");
              finishCard.className = "chat-bubble system";
              finishCard.innerHTML = `
                <div style="padding: 16px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px;">
                  <h4 style="margin: 0 0 8px 0; color: #fff;">Data Collection Complete</h4>
                  <p style="margin: 0 0 16px 0; font-size: 0.95rem; color: #ccc;">Your resume data has been finalized! You can proceed to pick a template, or <b>continue chatting</b> to ask me to change something.</p>
                  <button class="btn btn-primary btn-proceed" style="padding: 8px 16px; font-size: 0.9rem;">Review & Download</button>
                </div>
              `;
              chatMessages.appendChild(finishCard);
              finishCard.querySelector(".btn-proceed").addEventListener("click", () => {
                renderTemplateGrid();
                showView("template");
              });
              scrollChat();
            }

            // Save state when stream finishes completely
            saveState();
          }

          if (parsed.type === "error") {
            typingEl.classList.remove("visible");
            bubble.innerHTML = errorCard(parsed.content);
          }
        }
      }
    } catch (err) {
      bubble.innerHTML = errorCard("Connection lost. Please check your network and try again.");
      typingEl.classList.remove("visible");
    }

    state.isStreaming = false;
    btnSend.disabled = !chatInput.value.trim();
  }

  // ── Error Display ──────────────────────────────────────────
  function errorCard(message) {
    const isRateLimit = /rate limit|wait/i.test(message);
    const retryHtml = isRateLimit
      ? `<button class="error-retry-btn" onclick="startCooldown(this, 60)">Retry in 60 s</button>`
      : `<button class="error-retry-btn" onclick="retryLastMessage(this)">Retry</button>`;

    return `<div class="error-card">
      <div class="error-card-title">Unable to respond</div>
      <div class="error-card-msg">${escapeHtml(message)}</div>
      ${retryHtml}
    </div>`;
  }

  function cooldownCard(seconds) {
    const id = "cd-" + Date.now();
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.closest(".msg").remove();
    }, seconds * 1000);
    return `<div class="error-card" style="border-color:var(--text-3)">
      <div class="error-card-msg" style="color:var(--text-2)">Slow down — you can send again in <strong id="${id}">${seconds}</strong> s.</div>
    </div>`;
  }

  // Expose cooldown helper globally for inline onclick
  window.startCooldown = function (btn, sec) {
    btn.disabled = true;
    let remaining = sec;
    btn.textContent = `Retry in ${remaining} s`;
    const iv = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(iv);
        btn.textContent = "Retry";
        btn.disabled = false;
        btn.onclick = () => window.retryLastMessage(btn);
      } else {
        btn.textContent = `Retry in ${remaining} s`;
      }
    }, 1000);
  };

  // Expose retry helper globally
  window.retryLastMessage = function(btn) {
    btn.closest('.msg').remove();
    streamResponse();
  };

  // ── Markdown (using marked.js + DOMPurify) ────────────────
  function renderMarkdown(text) {
    if (!text) return "";
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      const rawHtml = marked.parse(text);
      return DOMPurify.sanitize(rawHtml);
    }
    // Fallback if CDNs fail to load
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/^[\-\*] (.+)$/gm, "<li>$1</li>");
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
    html = html.replace(/\n\n+/g, "</p><p>");
    html = "<p>" + html + "</p>";
    html = html.replace(/<p><\/p>/g, "");
    return html;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function stripTags(text) {
    return text
      .replace(/<live_preview>[\s\S]*?(?:<\/live_preview>|$)/g, "")
      .replace(/CLOAK_JSON_START[\s\S]*?(?:CLOAK_JSON_END|$)/g, "")
      .trim();
  }

  // ── Preview Panel ─────────────────────────────────────────
  function generatePreviewHtml(data) {
    if (!data) return "";
    const tplClass = state.selectedTemplate === "Modern Vanguard" ? "tpl-vanguard" : "tpl-sovereign";
    let html = `<div class="true-preview-paper ${tplClass}">`;

    if (data.personal) {
      html += `<div class="tp-header">`;
      
      if (data.personal.photo_url) {
        html += `<img class="tp-photo" src="${escapeHtml(data.personal.photo_url)}" alt="Profile Photo">`;
      }
      
      html += `<div class="tp-header-text">
        <div class="tp-name">${escapeHtml(data.personal.name || 'Your Name')}</div>
        <div class="tp-contact">`;
      const contact = [];
      if (data.personal.email) contact.push(escapeHtml(data.personal.email));
      if (data.personal.phone) contact.push(escapeHtml(data.personal.phone));
      if (data.personal.location) contact.push(escapeHtml(data.personal.location));
      if (data.personal.linkedin) contact.push(escapeHtml(data.personal.linkedin));
      if (data.personal.github) contact.push(escapeHtml(data.personal.github));
      if (data.personal.portfolio) contact.push(escapeHtml(data.personal.portfolio));
      html += contact.join(' • ') + `</div></div></div>`;
    }

    if (data.summary) {
      html += `<div class="tp-section">
        <div class="tp-section-title">Professional Summary</div>
        <div class="tp-summary">${escapeHtml(data.summary)}</div>
      </div>`;
    }

    if (data.experience && data.experience.length) {
      html += `<div class="tp-section">
        <div class="tp-section-title">Experience</div>`;
      data.experience.forEach(e => {
        html += `<div class="tp-item">
          <div class="tp-item-header">
            <span class="tp-item-title">${escapeHtml(e.company || '')}</span>
            <span class="tp-item-date">${escapeHtml(e.start || '')} - ${escapeHtml(e.end || '')}</span>
          </div>
          <div class="tp-item-sub">${escapeHtml(e.title || '')}${e.location ? ' | ' + escapeHtml(e.location) : ''}</div>
          <ul class="tp-bullets">`;
        if (e.bullets && Array.isArray(e.bullets)) {
          e.bullets.forEach(b => {
            html += `<li>${escapeHtml(b)}</li>`;
          });
        }
        html += `</ul></div>`;
      });
      html += `</div>`;
    }

    if (data.projects && data.projects.length) {
      html += `<div class="tp-section">
        <div class="tp-section-title">Projects</div>`;
      data.projects.forEach(p => {
        html += `<div class="tp-item">
          <div class="tp-item-header">
            <span class="tp-item-title">${escapeHtml(p.name || '')}</span>
            <span class="tp-item-date">${escapeHtml(p.date || '')}</span>
          </div>
          <div class="tp-item-sub">${escapeHtml(p.tech || '')}</div>
          <ul class="tp-bullets">`;
        if (p.bullets && Array.isArray(p.bullets)) {
          p.bullets.forEach(b => {
            html += `<li>${escapeHtml(b)}</li>`;
          });
        }
        html += `</ul></div>`;
      });
      html += `</div>`;
    }

    if (data.education && data.education.length) {
      html += `<div class="tp-section">
        <div class="tp-section-title">Education</div>`;
      data.education.forEach(e => {
        html += `<div class="tp-item">
          <div class="tp-item-header">
            <span class="tp-item-title">${escapeHtml(e.institution || '')}</span>
            <span class="tp-item-date">${escapeHtml(e.year || '')}</span>
          </div>`;
          let degreeField = [];
          if (e.degree) degreeField.push(e.degree);
          if (e.field) degreeField.push(e.field);
          let degreeStr = escapeHtml(degreeField.join(", "));
          if (e.percentage) {
            if (degreeStr) degreeStr += ` &nbsp;&bull;&nbsp; ${escapeHtml(e.percentage)}`;
            else degreeStr = escapeHtml(e.percentage);
          }
          if (e.gpa) {
            degreeStr += ` | GPA: ${escapeHtml(e.gpa)}`;
          }
          html += `<div class="tp-item-sub">${degreeStr}</div>
        </div>`;
      });
      html += `</div>`;
    }

    if (data.skills && Object.keys(data.skills).length) {
      html += `<div class="tp-section">
        <div class="tp-section-title">Skills</div>
        <div class="tp-skills">`;
      for (const [cat, list] of Object.entries(data.skills)) {
        const items = Array.isArray(list) ? list.join(", ") : list;
        html += `<div class="tp-skill-line"><strong>${escapeHtml(cat)}:</strong> ${escapeHtml(items)}</div>`;
      }
      html += `</div></div>`;
    }

    if (data.certifications && data.certifications.length) {
      html += `<div class="tp-section">
        <div class="tp-section-title">Certifications</div>`;
      data.certifications.forEach(c => {
        html += `<div class="tp-item">
          <div class="tp-item-header">
            <span class="tp-item-title">${escapeHtml(c.name || '')}</span>
            <span class="tp-item-date">${escapeHtml(c.year || '')}</span>
          </div>
          <div class="tp-item-sub">${escapeHtml(c.issuer || '')}</div>
        </div>`;
      });
      html += `</div>`;
    }

    // Render any custom sections
    const standardKeys = ["personal", "summary", "experience", "projects", "education", "skills", "certifications", "template"];
    for (const key of Object.keys(data)) {
      if (!standardKeys.includes(key) && Array.isArray(data[key]) && data[key].length) {
        html += `<div class="tp-section">
          <div class="tp-section-title">${escapeHtml(capitalize(key))}</div>`;
        data[key].forEach(item => {
          html += `<div class="tp-item">
            <div class="tp-item-header">
              <span class="tp-item-title">${escapeHtml(item.name || item.title || '')}</span>
              <span class="tp-item-date">${escapeHtml(item.year || item.date || '')}</span>
            </div>
            <div class="tp-item-sub">${escapeHtml(item.subtitle || item.issuer || item.organization || '')}</div>
            <ul class="tp-bullets">`;
          if (item.bullets && Array.isArray(item.bullets)) {
            item.bullets.forEach(b => {
              html += `<li>${escapeHtml(b)}</li>`;
            });
          }
          html += `</ul></div>`;
        });
        html += `</div>`;
      }
    }

    html += `</div>`;
    return html;
  }

  function renderPreview(data) {
    if (!data) return;
    previewEmpty.style.display = "none";
    previewBody.style.display = "block";
    previewBody.innerHTML = generatePreviewHtml(data);
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ── Template Grid ─────────────────────────────────────────
  function renderTemplateGrid(containerId) {
    const container = $("#" + containerId);
    if (!container) return;

    container.innerHTML = TEMPLATES.map((t) => `
      <div class="template-card ${t.id === state.selectedTemplate ? "selected" : ""}" data-template="${t.id}">
        <div class="template-card-img-wrap">
          <img src="${t.img}" alt="${t.name}" class="template-card-img">
          <div class="template-card-check">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
        </div>
        <div class="template-card-content">
          <div class="template-card-name">${t.name}</div>
          <div class="template-card-desc">${t.desc}</div>
          <div class="template-card-ats">ATS ${t.ats}/100</div>
        </div>
      </div>
    `).join("");

    container.querySelectorAll(".template-card").forEach((card) => {
      card.addEventListener("click", () => {
        state.selectedTemplate = card.dataset.template;
        saveState();
        container.querySelectorAll(".template-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        // instantly update preview if we are viewing it
        renderPreview(state.resumeData);
      });
    });
  }

  // ── ATS Analysis + Tailoring ────────────────────────────────
  let lastGapKeywords = [];
  let preTailorData = null;

  $("#btn-ats").addEventListener("click", async () => {
    const jd = $("#jd-input").value.trim();
    if (!jd || !state.userData) return;

    const btn = $("#btn-ats");
    btn.disabled = true;
    btn.textContent = "Analyzing...";

    // Reset tailor state
    $("#btn-tailor").style.display = "none";
    $("#tailor-result").classList.remove("visible", "loading");
    lastGapKeywords = [];

    try {
      const res = await fetch("/api/ats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_data: state.userData, job_description: jd }),
      });
      const report = await res.json();

      let scoreClass = "low";
      if (report.coverage_pct >= 65) scoreClass = "good";
      else if (report.coverage_pct >= 45) scoreClass = "mid";

      let html = `<div class="ats-score ${scoreClass}">${report.coverage_pct}% keyword match</div>`;

      if (report.gap_keywords && report.gap_keywords.length) {
        html += `<div style="font-size:.78rem;color:var(--text-2);margin-bottom:6px;font-weight:500">Missing keywords</div><div class="ats-gaps">`;
        report.gap_keywords.forEach(([kw, freq]) => {
          html += `<span class="ats-gap-tag">${escapeHtml(kw)} (${freq}x)</span>`;
        });
        html += "</div>";

        // Store gap keywords and show tailor button
        lastGapKeywords = report.gap_keywords.map(([kw]) => kw);
        $("#btn-tailor").style.display = "inline-flex";
      }

      if (report.present_keywords && report.present_keywords.length) {
        html += `<div style="font-size:.78rem;color:var(--text-2);margin-top:12px;margin-bottom:6px;font-weight:500">Matched keywords</div><div>`;
        report.present_keywords.forEach(([kw]) => {
          html += `<span class="ats-match-tag">${escapeHtml(kw)}</span>`;
        });
        html += "</div>";
      }

      atsResult.innerHTML = html;
      atsResult.classList.add("visible");
    } catch {
      atsResult.innerHTML = `<p style="color:var(--error);font-size:.82rem">Failed to analyze. Check server connection.</p>`;
      atsResult.classList.add("visible");
    }

    btn.disabled = false;
    btn.textContent = "Analyze";
  });

  // ── Tailor My Resume ──────────────────────────────────────
  $("#btn-tailor").addEventListener("click", async () => {
    const jd = $("#jd-input").value.trim();
    if (!jd || !state.userData || !lastGapKeywords.length) return;

    const btn = $("#btn-tailor");
    const tailorResult = $("#tailor-result");

    btn.disabled = true;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" class="spin"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="28" stroke-dashoffset="8"/></svg>
      Tailoring...
    `;

    // Save pre-tailor data for revert
    preTailorData = JSON.parse(JSON.stringify(state.userData));

    // Show shimmer loading
    tailorResult.className = "tailor-result loading";
    tailorResult.innerHTML = `<div style="color:var(--text-3);font-size:.82rem;text-align:center;padding:20px;">AI is rewriting your resume to match this job description...</div>`;

    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_data: state.userData,
          job_description: jd,
          gap_keywords: lastGapKeywords,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Tailoring failed");
      }

      const data = await res.json();
      const tailored = data.tailored;

      // Count what changed
      const changes = [];
      if (tailored.summary !== state.userData.summary) {
        changes.push({ label: "Summary", desc: "Rewritten to align with job priorities" });
      }
      const oldBullets = (state.userData.experience || []).flatMap(e => e.bullets || []);
      const newBullets = (tailored.experience || []).flatMap(e => e.bullets || []);
      const bulletChanges = newBullets.filter((b, i) => b !== oldBullets[i]).length;
      if (bulletChanges > 0) {
        changes.push({ label: "Experience", desc: `${bulletChanges} bullet point${bulletChanges > 1 ? "s" : ""} optimized with target keywords` });
      }
      const oldProjBullets = (state.userData.projects || []).flatMap(p => p.bullets || []);
      const newProjBullets = (tailored.projects || []).flatMap(p => p.bullets || []);
      const projChanges = newProjBullets.filter((b, i) => b !== oldProjBullets[i]).length;
      if (projChanges > 0) {
        changes.push({ label: "Projects", desc: `${projChanges} bullet${projChanges > 1 ? "s" : ""} enhanced for keyword coverage` });
      }
      const oldSkillCount = Object.values(state.userData.skills || {}).flat().length;
      const newSkillCount = Object.values(tailored.skills || {}).flat().length;
      if (newSkillCount > oldSkillCount) {
        changes.push({ label: "Skills", desc: `${newSkillCount - oldSkillCount} relevant skill${newSkillCount - oldSkillCount > 1 ? "s" : ""} added` });
      }
      if (!changes.length) {
        changes.push({ label: "Content", desc: "Bullet points refined for better ATS alignment" });
      }

      // Build result HTML
      let resultHtml = `
        <div class="tailor-result-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6 12 2.5 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Resume Tailored Successfully
        </div>
        <div class="tailor-result-desc">Your resume has been optimized for this job description. Here's what changed:</div>
        <div class="tailor-changes">
      `;
      changes.forEach(c => {
        resultHtml += `<div class="tailor-change-item"><div class="tailor-change-label">${escapeHtml(c.label)}</div>${escapeHtml(c.desc)}</div>`;
      });
      resultHtml += `</div>
        <div class="tailor-actions">
          <button class="btn btn-primary" id="btn-tailor-accept">Accept Changes</button>
          <button class="btn btn-secondary" id="btn-tailor-revert">Revert to Original</button>
        </div>`;

      // Apply tailored data temporarily for preview
      state.userData = tailored;
      saveState();
      renderPreview(state.userData);

      tailorResult.className = "tailor-result visible";
      tailorResult.innerHTML = resultHtml;

      // Accept button
      $("#btn-tailor-accept").addEventListener("click", () => {
        preTailorData = null;
        tailorResult.innerHTML = `<div class="tailor-result-title" style="color:var(--success);">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6 12 2.5 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Changes applied! Your resume is now optimized for this role.
        </div>`;
        // Re-run ATS to show improved score
        setTimeout(() => $("#btn-ats").click(), 500);
      });

      // Revert button
      $("#btn-tailor-revert").addEventListener("click", () => {
        if (preTailorData) {
          state.userData = preTailorData;
          preTailorData = null;
          saveState();
          renderPreview(state.userData);
        }
        tailorResult.className = "tailor-result";
        tailorResult.innerHTML = "";
      });

    } catch (err) {
      tailorResult.className = "tailor-result visible";
      tailorResult.innerHTML = `<div style="color:var(--error);font-size:.82rem;">${escapeHtml(err.message)}</div>`;
    }

    btn.disabled = false;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M12 2L4 14M4 2l8 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      Tailor My Resume
    `;
  });

  // ── PDF Download ──────────────────────────────────────────
  $("#btn-download").addEventListener("click", async () => {
    if (!state.userData) return;

    const btn = $("#btn-download");
    btn.disabled = true;
    downloadStatus.textContent = "Generating PDF...";
    downloadStatus.classList.add("visible");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_data: state.userData,
          template: state.selectedTemplate,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Generation failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?(.+?)"?$/);
      a.download = match ? match[1] : "resume.pdf";
      a.href = url;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      downloadStatus.textContent = "Download started.";

      // Show review modal 3 seconds after successful download
      if (!localStorage.getItem("cloak_reviewed")) {
        setTimeout(() => {
          $("#review-modal").classList.add("visible");
        }, 3000);
      }
    } catch (err) {
      downloadStatus.textContent = err.message;
      downloadStatus.style.color = "var(--error)";
    }

    btn.disabled = false;
    setTimeout(() => {
      downloadStatus.classList.remove("visible");
      downloadStatus.style.color = "";
    }, 4000);
  });

  // ── Reviews System ─────────────────────────────────────────
  const STAR_LABELS = ["", "Terrible", "Poor", "Okay", "Great", "Amazing!"];
  let selectedRating = 0;

  // Star picker interaction
  document.querySelectorAll("#review-stars .review-star").forEach(star => {
    star.addEventListener("click", () => {
      selectedRating = parseInt(star.dataset.value);
      document.querySelectorAll("#review-stars .review-star").forEach(s => {
        s.classList.toggle("active", parseInt(s.dataset.value) <= selectedRating);
      });
      $("#review-star-label").textContent = STAR_LABELS[selectedRating] || "";
    });

    star.addEventListener("mouseenter", () => {
      const val = parseInt(star.dataset.value);
      document.querySelectorAll("#review-stars .review-star").forEach(s => {
        const sv = parseInt(s.dataset.value);
        if (sv <= val) {
          s.style.color = "var(--accent)";
          s.style.opacity = "0.7";
        }
      });
    });

    star.addEventListener("mouseleave", () => {
      document.querySelectorAll("#review-stars .review-star").forEach(s => {
        s.style.color = "";
        s.style.opacity = "";
      });
    });
  });

  // Skip button
  $("#btn-review-skip").addEventListener("click", () => {
    $("#review-modal").classList.remove("visible");
  });

  // Close on backdrop click
  $("#review-modal").addEventListener("click", (e) => {
    if (e.target === $("#review-modal")) {
      $("#review-modal").classList.remove("visible");
    }
  });

  // Leave a Review button on landing
  $("#btn-leave-review").addEventListener("click", () => {
    selectedRating = 0;
    document.querySelectorAll("#review-stars .review-star").forEach(s => s.classList.remove("active"));
    $("#review-star-label").textContent = "Select a rating";
    $("#review-name").value = "";
    $("#review-comment").value = "";
    $("#review-feedback").textContent = "";
    $("#review-modal").classList.add("visible");
  });

  // Submit review
  $("#btn-review-submit").addEventListener("click", async () => {
    if (selectedRating === 0) {
      $("#review-feedback").textContent = "Please select a star rating.";
      $("#review-feedback").style.color = "var(--error)";
      return;
    }
    const comment = $("#review-comment").value.trim();
    if (!comment) {
      $("#review-feedback").textContent = "Please write a short comment.";
      $("#review-feedback").style.color = "var(--error)";
      return;
    }

    const btn = $("#btn-review-submit");
    btn.disabled = true;
    btn.textContent = "Submitting...";

    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: $("#review-name").value.trim() || "Anonymous",
          rating: selectedRating,
          comment: comment,
          template: state.selectedTemplate || "",
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Submission failed");
      }

      localStorage.setItem("cloak_reviewed", "1");
      $("#review-feedback").style.color = "var(--success)";
      $("#review-feedback").textContent = "Thank you for your review! ✨";

      setTimeout(() => {
        $("#review-modal").classList.remove("visible");
        fetchAndRenderReviews();
      }, 1500);
    } catch (err) {
      $("#review-feedback").style.color = "var(--error)";
      $("#review-feedback").textContent = err.message;
    }

    btn.disabled = false;
    btn.textContent = "Submit Review";
  });

  // Relative time formatter
  function timeAgo(dateStr) {
    const now = new Date();
    const d = new Date(dateStr);
    const diffMs = now - d;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }

  // Render review cards
  function renderReviewCards(reviews) {
    const grid = $("#reviews-grid");
    if (!reviews.length) {
      grid.innerHTML = '<div class="reviews-empty">No reviews yet. Be the first to share your experience!</div>';
      return;
    }

    // Show the latest 6 reviews max
    const display = reviews.slice(0, 6);
    grid.innerHTML = display.map(r => {
      let stars = "";
      for (let i = 1; i <= 5; i++) {
        stars += `<span class="review-card-star${i > r.rating ? " empty" : ""}">&#9733;</span>`;
      }
      return `
        <div class="review-card">
          <div class="review-card-stars">${stars}</div>
          <div class="review-card-comment">${escapeHtml(r.comment)}</div>
          <div class="review-card-footer">
            <span class="review-card-name">${escapeHtml(r.name || "Anonymous")}</span>
            <span class="review-card-meta">${r.template ? escapeHtml(r.template) + " · " : ""}${timeAgo(r.date)}</span>
          </div>
        </div>`;
    }).join("");
  }

  // Fetch reviews from API
  async function fetchAndRenderReviews() {
    try {
      const res = await fetch("/api/reviews");
      if (res.ok) {
        const reviews = await res.json();
        renderReviewCards(reviews);
      }
    } catch {
      // Silently fail — reviews are non-critical
    }
  }

  // ── 3D Card Tilt Effect ─────────────────────────────────────
  (function initCardTilt() {
    const MAX_TILT = 8; // degrees
    let tiltFrame = null;

    function handleTiltMove(e) {
      const card = e.currentTarget;
      if (tiltFrame) return; // Throttle to 1 update per frame
      tiltFrame = requestAnimationFrame(() => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateY = ((x - centerX) / centerX) * MAX_TILT;
        const rotateX = ((centerY - y) / centerY) * MAX_TILT;
        card.style.transform = `perspective(800px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateZ(4px)`;
        // Update spotlight position
        card.style.setProperty('--card-x', x + 'px');
        card.style.setProperty('--card-y', y + 'px');
        tiltFrame = null;
      });
    }

    function handleTiltLeave(e) {
      const card = e.currentTarget;
      card.style.transform = '';
      card.style.removeProperty('--card-x');
      card.style.removeProperty('--card-y');
    }

    function attachTilt(selector) {
      document.querySelectorAll(selector).forEach(card => {
        card.addEventListener('mousemove', handleTiltMove, { passive: true });
        card.addEventListener('mouseleave', handleTiltLeave, { passive: true });
      });
    }

    // Attach on initial load
    attachTilt('.feature-card');
    attachTilt('.review-card');

    // Re-attach after reviews are rendered (they get re-created)
    const origRenderReviewCards = renderReviewCards;
    renderReviewCards = function(reviews) {
      origRenderReviewCards(reviews);
      setTimeout(() => attachTilt('.review-card'), 50);
    };

    // Re-attach after template grid is rendered
    const origRenderTemplateGrid = renderTemplateGrid;
    renderTemplateGrid = function(containerId) {
      origRenderTemplateGrid(containerId);
      setTimeout(() => attachTilt('.template-card'), 50);
    };
  })();

  // ── Ambient Glow Tracking ──────────────────────────────────
  (function initGlow() {
    const landingGlow = document.querySelector('.landing-glow');
    const templateGlow = document.querySelector('.template-glow');

    let glowFrame = null;

    document.addEventListener('mousemove', (e) => {
      if (glowFrame) return;
      glowFrame = requestAnimationFrame(() => {
        // Landing glow
        const landing = document.getElementById('view-landing');
        if (landing && landing.classList.contains('active') && landingGlow) {
          const rect = landing.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width * 100).toFixed(1);
          const y = ((e.clientY - rect.top) / rect.height * 100).toFixed(1);
          landingGlow.style.setProperty('--glow-x', x + '%');
          landingGlow.style.setProperty('--glow-y', y + '%');
          if (!landingGlow.classList.contains('active')) landingGlow.classList.add('active');
        }

        // Template view glow
        const tplView = document.getElementById('view-template');
        if (tplView && tplView.classList.contains('active') && templateGlow) {
          const rect = tplView.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width * 100).toFixed(1);
          const y = ((e.clientY - rect.top) / rect.height * 100).toFixed(1);
          templateGlow.style.setProperty('--tpl-glow-x', x + '%');
          templateGlow.style.setProperty('--tpl-glow-y', y + '%');
          if (!templateGlow.classList.contains('active')) templateGlow.classList.add('active');
        }

        glowFrame = null;
      });
    }, { passive: true });

    document.addEventListener('mouseleave', () => {
      if (landingGlow) landingGlow.classList.remove('active');
      if (templateGlow) templateGlow.classList.remove('active');
    }, { passive: true });
  })();

  // ── Global Cursor Spotlight ───────────────────────────────
  (function initCursorGlow() {
    const glow = document.getElementById('cursor-glow');
    if (!glow) return;

    let curX = 0, curY = 0, targetX = 0, targetY = 0;
    let active = false;
    let rafId = null;

    function lerp() {
      curX += (targetX - curX) * 0.15;
      curY += (targetY - curY) * 0.15;
      glow.style.left = curX + 'px';
      glow.style.top = curY + 'px';
      rafId = requestAnimationFrame(lerp);
    }

    document.addEventListener('mousemove', (e) => {
      targetX = e.clientX;
      targetY = e.clientY;
      if (!active) {
        active = true;
        glow.classList.add('active');
        rafId = requestAnimationFrame(lerp);
      }
    }, { passive: true });

    document.addEventListener('mouseleave', () => {
      active = false;
      glow.classList.remove('active');
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    });

    // Switch to warm red glow when donate modal is open
    const donateObs = new MutationObserver(() => {
      const donateEl = document.getElementById('donate-modal');
      if (donateEl && donateEl.classList.contains('visible')) {
        glow.classList.add('donate-mode');
      } else {
        glow.classList.remove('donate-mode');
      }
    });
    const donateEl = document.getElementById('donate-modal');
    if (donateEl) donateObs.observe(donateEl, { attributes: true, attributeFilter: ['class'] });
  })();
  // ── Init ───────────────────────────────────────────────────
  renderTemplateGrid();
  fetchAndRenderReviews();
  
  if (loadState()) {
    showView(state.currentView, true);
  } else {
    showView("landing", true);
  }
})();
