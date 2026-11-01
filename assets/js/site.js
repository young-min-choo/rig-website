/* RIG site behaviour — progressive enhancement only; every page works without it.
   1. Header turns solid once the home hero scrolls away.
   2. Hero video: loaded only when footage is configured AND the visitor has not
      asked for reduced motion or data saving. Otherwise the still image stays.
   3. Forms: post to data-endpoint when one is configured; until then, say so
      plainly instead of pretending to send. */
(function () {
  "use strict";

  // 1. header
  var header = document.querySelector(".site-header");
  if (header && document.body.classList.contains("home")) {
    var onScroll = function () { header.classList.toggle("solid", window.scrollY > 40); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // 2. hero video
  var media = document.querySelector(".hero-media[data-video-mp4]");
  if (media) {
    var mp4 = media.getAttribute("data-video-mp4");
    var webm = media.getAttribute("data-video-webm");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var saveData = navigator.connection && navigator.connection.saveData;
    if (mp4 && !reduce && !saveData) {
      var still = media.querySelector("img");
      var v = document.createElement("video");
      v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
      v.setAttribute("muted", ""); v.setAttribute("playsinline", "");
      v.setAttribute("aria-hidden", "true");
      if (still) v.poster = still.currentSrc || still.src;
      if (webm) { var s1 = document.createElement("source"); s1.src = webm; s1.type = "video/webm"; v.appendChild(s1); }
      var s2 = document.createElement("source"); s2.src = mp4; s2.type = "video/mp4"; v.appendChild(s2);
      v.addEventListener("playing", function () { if (still) still.hidden = true; });
      media.insertBefore(v, media.firstChild);
    }
  }

  // 3. forms
  Array.prototype.forEach.call(document.querySelectorAll("form[data-endpoint]"), function (form) {
    var status = form.querySelector(".form-status");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var endpoint = form.getAttribute("data-endpoint");
      if (!endpoint) {
        status.textContent = "Online enquiries open shortly. Until then, please write to info@regenig.com.";
        return;
      }
      var btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      status.textContent = "Sending…";
      fetch(endpoint, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } })
        .then(function (r) {
          if (!r.ok) throw new Error(r.status);
          form.reset();
          status.textContent = "Thank you. A coordinator will be in touch personally, in confidence.";
        })
        .catch(function () {
          status.textContent = "Your message could not be sent. Please write to info@regenig.com.";
        })
        .then(function () { btn.disabled = false; });
    });
  });
})();
