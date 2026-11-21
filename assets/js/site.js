/* RIG site behaviour — progressive enhancement only; every page works without it.
   1. Header turns solid once the home hero scrolls away.
   2. Hero video: loaded only when footage is configured AND the visitor has not
      asked for reduced motion or data saving. Otherwise the still image stays.
   3. Forms: post to data-endpoint (/api/enquiry) with Accept: application/json
      and show the outcome inline; a live character count under the message.
      Without JS the form is a normal POST that lands on thanks.html,
      enquiry-error.html or enquiry-too-long.html. */
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
  // Message limit (ruling R2): no maxlength, so nothing is cut off silently. A quiet live count
  // sits under the message; assistive tech hears it only near or over the limit; an over-long
  // message is not sent and its text stays in the field.
  // countChars must stay identical to countChars() in functions/api/enquiry.js (unit-tested).
  function countChars(v) { return String(v).replace(/\r\n?/g, "\n").trim().length; }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function chars(n) { return fmt(n) + (n === 1 ? " character" : " characters"); }
  function tooLongText(limit, over) {
    return "Messages are limited to " + fmt(limit) + " characters. Please shorten yours" +
      (over > 0 ? " by " + fmt(over) : "") + ", or write to info@regenig.com.";
  }
  var NEAR = 0.9; // announce from 90% of the limit

  Array.prototype.forEach.call(document.querySelectorAll("form[data-endpoint]"), function (form) {
    var status = form.querySelector(".form-status");
    var msg = form.querySelector("textarea[data-maxchars]");
    var limit = msg ? parseInt(msg.getAttribute("data-maxchars"), 10) : 0;
    var num = null, count = null, live = null, liveTimer = null;

    function update() {
      var n = countChars(msg.value);
      var over = n > limit;
      num.textContent = fmt(n) + " / " + fmt(limit);
      count.classList.toggle("is-over", over);
      if (over) msg.setAttribute("aria-invalid", "true"); else msg.removeAttribute("aria-invalid");
      clearTimeout(liveTimer);
      liveTimer = setTimeout(function () {
        live.textContent = n < limit * NEAR ? "" : over
          ? "Your message is " + chars(n - limit) + " over the limit of " + fmt(limit) + "."
          : chars(limit - n) + " left.";
      }, 700);
    }

    if (msg && limit > 0) {
      count = document.createElement("p");
      count.className = "form-count";
      count.id = msg.id + "-count";
      num = document.createElement("span");
      var unit = document.createElement("span");
      unit.className = "sr-only";
      unit.textContent = " characters";
      count.appendChild(num);
      count.appendChild(unit);
      live = document.createElement("p");
      live.className = "sr-only";
      live.setAttribute("aria-live", "polite");
      live.setAttribute("data-count-live", "");
      msg.parentNode.appendChild(count);
      msg.parentNode.appendChild(live);
      msg.setAttribute("aria-describedby", ((msg.getAttribute("aria-describedby") || "") + " " + count.id).trim());
      msg.addEventListener("input", update);
      form.addEventListener("reset", function () { setTimeout(update, 0); });
      update();
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var endpoint = form.getAttribute("data-endpoint");
      if (!endpoint) {
        status.textContent = "Online enquiries open shortly. Until then, please write to info@regenig.com.";
        return;
      }
      if (msg && limit > 0 && countChars(msg.value) > limit) {
        status.textContent = tooLongText(limit, countChars(msg.value) - limit);
        msg.focus();
        return;
      }
      if (typeof form.checkValidity === "function" && !form.checkValidity()) {
        status.textContent = "Please complete the required fields and tick the consent box.";
        return;
      }
      var btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      status.textContent = "Sending…";
      fetch(endpoint, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } })
        .then(function (r) {
          if (r.ok) {
            form.reset();
            status.textContent = "Thank you. A coordinator will be in touch personally, in confidence.";
            return;
          }
          return r.json().catch(function () { return {}; }).then(function (b) { throw new Error((b && b.error) || r.status); });
        })
        .catch(function (err) {
          status.textContent = /^(message_too_long|too_large)$/.test(String(err && err.message))
            ? tooLongText(limit || 5000, 0)
            : "Your message could not be sent. Please write to info@regenig.com.";
        })
        .then(function () { btn.disabled = false; });
    });
  });
})();
