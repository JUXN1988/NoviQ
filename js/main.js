/* NoviQ — página pública (GitHub Pages).
 * Solo interfaz: idioma, menú móvil, galería y animación.
 * No envía datos a ningún servidor ni registra visitas. */
(function () {
  "use strict";

  var KEY = "noviq_lang";

  var EN = {
    nav_feat: "Features", nav_shots: "Screenshots", nav_avatar: "Avatar", nav_run: "Run",
    nav_lic: "License", nav_fb: "Feedback", nav_gh: "GitHub",

    hero_pill: "In active development · runs from source",
    hero_t1: "The AI agent that codes", hero_t2: "on your own computer.",
    hero_p: "NoviQ writes the files, runs the program, reads the errors and fixes them. Use cloud models or local models with Ollama and LM Studio.",
    hero_run: "How to run it", hero_gh: "See the code on GitHub",
    tr1: "Free for personal use", tr2: "Cloud or local models", tr3: "Asks permission for risky actions", tr4: "Spanish and English",
    float1: "Runs the program and reads the exact error", float2: "A plan you can edit before it acts",

    strip_t: "AI providers you can connect",

    n1: "agent tools: files, code, PowerShell, Python, Linux, web and browser",
    n2: "permission modes; the default one asks before acting",
    n3: "interface languages: Spanish and English",
    n4: "minimum Python version to run it",

    feat_k: "Features", feat_t: "What it does, today",
    feat_p: "These are the features that exist in the current program.",
    f1t: "40 tools", f1d: "Files, code search, PowerShell, Python, Linux, processes, HTTP, web search and reading, images, screenshots, automated browser and more.",
    f2t: "Plan before acting", f2d: "You can edit or approve the plan. If you do nothing, it is approved automatically after a countdown.",
    f3t: "Tests itself", f3d: "The diagnosticar tool reviews the project with file and line; probar_web tests web apps and games in an invisible browser.",
    f4t: "Reasoning guardian", f4d: "If a model thinks too long without acting or loops, NoviQ stops it and makes it act.",
    f5t: "Escalation to the most capable model", f5d: "If the agent gets stuck, the work moves to the most capable model you have enabled.",
    f6t: "Work that is not lost", f6d: "Keeps the goal, the plan, what is done and the errors. If a model fails, the next one continues from there.",
    f7t: "Local AI", f7d: "Ollama and LM Studio, with context sized to your computer's memory. Your code stays on your PC.",
    f8t: "Security", f8d: "Permission modes, backups and restore points, deletes go to the Recycle Bin, secret scanner and key vault.",
    f9t: "Providers and MCP", f9d: "NVIDIA, Gemini, OpenAI, Anthropic, OpenRouter, Groq and more. MCP servers with the same format as Claude Desktop.",

    shots_k: "Real screenshots", shots_t: "What the program looks like",
    gal_1: "Building live", gal_2: "Editable plan", gal_3: "Choosing a model", gal_4: "Projects", gal_5: "Home",

    av_k: "Included in the repository", av_t: "The avatar: noviq-avatar",
    av_p: "A robot that lives above any program, with a transparent background. It has its own mind, memory, personality, voice, hearing, tools and API. It works on its own, with NoviQ or from another application.",
    fr1t: "Greets", fr1d: "introduces itself when you open it.",
    fr2t: "Works", fr2d: "when NoviQ starts a job.",
    fr3t: "Analyzes", fr3d: "circuits and data panels come out of its head.",
    fr4t: "Uses tools", fr4d: "an icon on its visor for the tool in use.",
    fr5t: "Asks permission", fr5d: "«I need your permission…» and you answer yes or no.",
    st_t: "What it does at each moment",
    st1: "<b>Starts a job:</b> wakes up, looks focused and writes in its panel.",
    st2: "<b>Uses tools:</b> shows an icon for the tool: code, magnifier, terminal or web.",
    st3: "<b>Moves through tasks:</b> a small tablet with a progress bar and the current task.",
    st4: "<b>Asks permission or help:</b> sensitive actions are approved by answering yes or no, without saying its name.",
    st5: "<b>Finishes:</b> says «Done!» and asks what we do next.",
    m1t: "Own mind", m1d: "Answers instantly about the time, reminders and schedule. For everything else it uses the model you have configured.",
    m2t: "Permanent memory", m2d: "Keeps your name, what you tell it, plans and reminders in its own memory file.",
    m3t: "Combinable personality", m3d: "Up to four traits (curious, calm, teacher, sarcastic and more) that change its face, pace and tone.",
    m4t: "Voice and hearing", m4d: "Speaks with its own voices and listens all the time, but only reacts when you say its name (or as you configure it).",
    m5t: "API and MCP", m5d: "HTTP and WebSocket API compatible with OpenAI (/v1/chat/completions) and an MCP server for other applications.",
    m6t: "Its own tools", m6d: "Search and read the internet, open websites, folders and programs, clipboard, reminders and calculator.",
    av_note_b: "Note:",
    av_note: "the avatar is designed for Windows (it uses its paths, its voices and its key vault). On Linux and macOS the program runs with iniciar.sh, but the avatar is not designed for those systems.",

    run_k: "Run", run_t: "Run it from the source code",
    run_p: "No installers are published yet. You need Python 3.10 or newer.",
    r1t: "Windows", r1d: "Download the repository (<b>Code</b> → <b>Download ZIP</b>) or clone it. Then double-click <code>iniciar.bat</code>.",
    r2t: "Linux and macOS", r2d: "In the project folder, run <code>bash iniciar.sh</code>.",
    r3t: "First use", r3d: "Go to Settings → Providers & keys, paste an API key from a provider (or connect Ollama / LM Studio) and start a conversation.",
    run_manual: "To run it manually: <code>python app.py</code> and open <code>http://127.0.0.1:7860</code>.",

    sec_k: "Security", sec_t: "Permissions and backups before acting",
    sec_p: "These are the protections in the current code.",
    c1: "Three permission modes: ask (the default), auto_seguro and auto.",
    c2: "Restore points and a tool to undo changes.",
    c3: "Deleted files go to the Recycle Bin, not deleted directly.",
    c4: "Secret scanner to detect exposed keys in the code.",
    c5: "With local models, your code does not leave your computer.",
    c6: "Key vault: on Windows it is encrypted with DPAPI. On Linux and macOS it is stored obfuscated with 600 permissions, <b>not encrypted</b>.",

    lic_k: "License", lic_t: "Free for personal use",
    lic_p: "NoviQ is free for personal use. Commercial use (by companies, organizations, microenterprises or self-employed people who earn income) requires a paid commercial license: open an issue with the label <b>business</b>. This is not open-source software: the code is visible, but commercial use is paid.",
    lic_link: "Read the full license", road_link: "Roadmap", chg_link: "Changelog", doc_link: "Full documentation",

    faq_t: "Frequently asked questions",
    q1: "Does my code leave my computer?",
    a1: "With local models (Ollama or LM Studio), no. With cloud models, the text needed for each task is sent to the provider you choose.",
    q2: "Do I need a GPU?",
    a2: "It is not required. With cloud models it works on any computer; local models depend on your computer's memory.",
    q3: "Is there an installer?",
    a3: "Not yet. For now it runs from the source code with iniciar.bat (Windows) or iniciar.sh (Linux and macOS).",
    q4: "Can it do something risky without asking?",
    a4: "It depends on the permission mode. The default mode asks before acting, and restore points let you go back.",

    fb_k: "Community", fb_t: "Comments and suggestions",
    fb_p: "The project is being updated. Your feedback helps a lot: bugs and improvements are reviewed on GitHub.",
    fb_bug: "🐞 Report a bug", fb_feat: "💡 Suggest an improvement", fb_all: "📋 See open issues"
  };

  var lang = "es";
  try {
    var saved = localStorage.getItem(KEY);
    if (saved === "es" || saved === "en") { lang = saved; }
    else { lang = (navigator.language || "").indexOf("es") === 0 ? "es" : "en"; }
  } catch (e) {
    lang = (navigator.language || "").indexOf("es") === 0 ? "es" : "en";
  }

  // Guarda el texto en español original de cada elemento traducible.
  var textNodes = document.querySelectorAll("[data-i]");
  for (var i = 0; i < textNodes.length; i++) {
    textNodes[i].__es = textNodes[i].innerHTML;
  }

  var langBtn = document.getElementById("langBtn");
  var shotImg = document.getElementById("shotImg");
  var shotCap = document.getElementById("shotCap");
  var tabs = document.querySelectorAll(".shots .tabs button");
  var currentShot = "work";

  function applyLang() {
    document.documentElement.lang = lang;
    for (var n = 0; n < textNodes.length; n++) {
      var el = textNodes[n];
      var key = el.getAttribute("data-i");
      if (lang === "en" && EN[key] !== undefined) {
        el.innerHTML = EN[key];
      } else {
        el.innerHTML = el.__es;
      }
    }
    var heroImgs = document.querySelectorAll("[data-src-es]");
    for (var h = 0; h < heroImgs.length; h++) {
      heroImgs[h].src = lang === "en" ? heroImgs[h].getAttribute("data-src-en") : heroImgs[h].getAttribute("data-src-es");
    }
    langBtn.textContent = lang === "en" ? "ES" : "EN";
    langBtn.setAttribute("aria-label", lang === "en" ? "Cambiar a español" : "Switch to English");
    setShot(currentShot);
  }

  function setShot(k) {
    currentShot = k;
    shotImg.src = "docs/img/" + k + "_" + lang + ".webp";
    shotImg.alt = lang === "en" ? "NoviQ screenshot" : "Captura de NoviQ";
    for (var t = 0; t < tabs.length; t++) {
      var on = tabs[t].getAttribute("data-shot") === k;
      tabs[t].classList.toggle("on", on);
      if (on) { shotCap.innerHTML = tabs[t].innerHTML; }
    }
  }

  langBtn.addEventListener("click", function () {
    lang = lang === "en" ? "es" : "en";
    try { localStorage.setItem(KEY, lang); } catch (e) { /* almacenamiento no disponible: no pasa nada */ }
    applyLang();
  });

  for (var b = 0; b < tabs.length; b++) {
    tabs[b].addEventListener("click", function () {
      setShot(this.getAttribute("data-shot"));
    });
  }

  // Menú móvil
  var nav = document.querySelector(".nav");
  var menuBtn = document.getElementById("menuBtn");
  menuBtn.addEventListener("click", function () { nav.classList.toggle("open"); });
  var navLinks = document.querySelectorAll(".nav .links a");
  for (var l = 0; l < navLinks.length; l++) {
    navLinks[l].addEventListener("click", function () { nav.classList.remove("open"); });
  }

  // Animación de aparición (solo si el navegador la soporta; sin JS el contenido se ve igual)
  if ("IntersectionObserver" in window) {
    document.documentElement.classList.add("js-reveal");
    var targets = document.querySelectorAll(".grid .card, .head, .checks li, .nums > div, .window.big, .av-frames figure");
    for (var r = 0; r < targets.length; r++) { targets[r].classList.add("reveal"); }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    for (var q = 0; q < targets.length; q++) { io.observe(targets[q]); }
  }

  applyLang();
})();
