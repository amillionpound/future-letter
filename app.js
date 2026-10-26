(function () {
  "use strict";

  // ---- 解析接口地址 ----
  var params = new URLSearchParams(location.search);
  var API = params.get("api") || window.FUTURE_LETTER_API || "";
  if (API.indexOf("__FILL_ME__") !== -1) API = "";

  var $ = function (id) { return document.getElementById(id); };
  var envelope = $("envelope");
  var letterSec = $("letter");
  var letterBody = $("letterBody");
  var updatedAt = $("updatedAt");
  var seal = $("seal");
  var sealText = $("sealText");
  var lockBadge = $("lockBadge");
  var tamperWarn = $("tamperWarn");

  var adminFab = $("adminFab");
  var adminModal = $("adminModal");
  var tokenInput = $("tokenInput");
  var contentInput = $("contentInput");
  var saveBtn = $("saveBtn");
  var lockBtn = $("lockBtn");
  var closeBtn = $("closeBtn");
  var adminMsg = $("adminMsg");

  var state = { content: "", locked: false };

  function fmtTime(ts) {
    if (!ts) return "";
    var d = new Date(ts * 1000);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return "最后保存:" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function renderLetter(data) {
    state.content = data.content || "";
    state.locked = !!data.locked;

    if (data.tampered) {
      tamperWarn.classList.remove("hidden");
    } else {
      tamperWarn.classList.add("hidden");
    }

    if (state.content) {
      letterBody.textContent = state.content;
    } else {
      letterBody.innerHTML = '<p class="placeholder">这封信还是空的。用右下角的编辑按钮,把想对五年后的自己说的话写进来吧。</p>';
    }
    updatedAt.textContent = fmtTime(data.updated_at);

    // 指纹
    if (data.hash) {
      seal.classList.toggle("bad", !!data.tampered);
      sealText.innerHTML = "内容指纹已校验 ✓ <code>" + data.hash.slice(0, 16) + "…</code>";
    } else {
      sealText.textContent = "还没有内容";
    }

    if (state.locked) {
      lockBadge.classList.remove("hidden");
    } else {
      lockBadge.classList.add("hidden");
    }
  }

  function showError(msg) {
    adminMsg.textContent = msg;
    adminMsg.className = "modal-msg err";
  }
  function showOk(msg) {
    adminMsg.textContent = msg;
    adminMsg.className = "modal-msg ok";
  }

  function apiUrl(path) {
    return API.replace(/\/+$/, "") + path;
  }

  function openLetter() {
    if (!API) {
      alert("前端尚未配置 SCF 接口地址。请部署后端后,在 config.js 填入访问地址(或加 ?api= 临时指定)。");
      return;
    }
    envelope.classList.add("open");
    setTimeout(function () {
      envelope.classList.add("hidden");
      letterSec.classList.remove("hidden");
    }, 500);

    fetch(apiUrl("/letter"), { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.json(); })
      .then(renderLetter)
      .catch(function (e) {
        letterBody.innerHTML = '<p class="placeholder">读取信件失败:' + (e && e.message ? e.message : e) + "</p>";
      });
  }

  function saveLetter() {
    var token = tokenInput.value.trim();
    if (!token) { showError("请先输入管理口令"); return; }
    saveBtn.disabled = true;
    fetch(apiUrl("/letter"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": token },
      body: JSON.stringify({ content: contentInput.value })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j.error || "保存失败");
        sessionStorage.setItem("fl_token", token);
        showOk("已保存。指纹:" + res.j.hash.slice(0, 16) + "…");
        renderLetter({ content: contentInput.value, hash: res.j.hash, updated_at: res.j.updated_at, locked: state.locked });
      })
      .catch(function (e) { showError("保存失败:" + e.message); })
      .finally(function () { saveBtn.disabled = false; });
  }

  function lockLetter() {
    var token = tokenInput.value.trim();
    if (!token) { showError("请先输入管理口令"); return; }
    if (!confirm("锁定后内容将永久不可修改(真正的防篡改)。确定封印?")) return;
    lockBtn.disabled = true;
    fetch(apiUrl("/lock"), {
      method: "POST",
      headers: { "X-Admin-Token": token }
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j.error || "锁定失败");
        showOk("已封印,内容不可再改。");
        state.locked = true;
        lockBadge.classList.remove("hidden");
      })
      .catch(function (e) { showError("锁定失败:" + e.message); })
      .finally(function () { lockBtn.disabled = false; });
  }

  // ---- 事件 ----
  $("openBtn").addEventListener("click", openLetter);
  adminFab.addEventListener("click", function () {
    tokenInput.value = sessionStorage.getItem("fl_token") || "";
    contentInput.value = state.content;
    adminMsg.textContent = "";
    adminMsg.className = "modal-msg";
    adminModal.classList.remove("hidden");
  });
  closeBtn.addEventListener("click", function () { adminModal.classList.add("hidden"); });
  saveBtn.addEventListener("click", saveLetter);
  lockBtn.addEventListener("click", lockLetter);
  adminModal.addEventListener("click", function (e) {
    if (e.target === adminModal) adminModal.classList.add("hidden");
  });
})();
