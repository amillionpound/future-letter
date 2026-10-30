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
  var logsBtn = $("logsBtn");
  var logsBox = $("logsBox");
  var closeBtn = $("closeBtn");
  var adminMsg = $("adminMsg");

  var state = { hasLetter: false, locked: false };

  function fmtTime(ts) {
    if (!ts) return "";
    var d = new Date(ts * 1000);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return "最后保存:" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
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

  // ---- 访问记录埋点 ----
  function logBehavior(behavior) {
    if (!API) return;
    fetch(apiUrl("/log"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ behavior: behavior })
    }).catch(function () { /* 记录失败不影响阅读 */ });
  }

  // ---- base64 / hex 工具 ----
  function b64ToBytes(b64) {
    var bin = atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function bufToHex(buf) {
    var b = new Uint8Array(buf);
    var s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }

  // ---- Web Crypto 解密并校验哈希 ----
  async function decryptLetter(ciphertextB64, keyB64, expectedHash) {
    var raw = b64ToBytes(ciphertextB64);
    var nonce = raw.slice(0, 12);
    var ct = raw.slice(12);
    var keyBytes = b64ToBytes(keyB64);
    var cryptoKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    var plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, cryptoKey, ct);
    var text = new TextDecoder("utf-8").decode(plainBuf);
    var hBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return { text: text, ok: bufToHex(hBuf) === expectedHash };
  }

  function showLocked(data) {
    var d = data.unlock_at ? new Date(data.unlock_at) : null;
    var txt = d ? ("预计 " + d.toLocaleString() + " 解封") : "尚未设定解封时间";
    if (data.key_ready && !data.key_released) txt += " · 但密钥密文尚未发布";
    letterBody.innerHTML = '<p class="placeholder">🔒 ' + txt +
      '<br/>这封信已加密保存,到时自动解封。</p>';
  }

  function renderLetter(data) {
    state.hasLetter = !!data.has_letter;
    state.locked = !!data.locked;

    if (data.hash) {
      sealText.innerHTML = "内容指纹:<code>" + data.hash.slice(0, 16) + "…</code>";
    } else {
      sealText.textContent = "还没有内容";
    }

    if (state.locked) {
      lockBadge.classList.remove("hidden");
    } else {
      lockBadge.classList.add("hidden");
    }

    if (!state.hasLetter) {
      letterBody.innerHTML = '<p class="placeholder">这封信还是空的。用右下角的编辑按钮,把想对五年后的自己说的话写进来吧。</p>';
      return;
    }

    if (data.key_ready && data.key_released) {
      // 到期且密钥已发布 -> 取密钥并解密
      fetch(apiUrl("/letter/key"))
        .then(function (r) { return r.json(); })
        .then(function (kd) {
          if (!kd.released) { showLocked(data); return; }
          decryptLetter(data.ciphertext, kd.key, data.hash)
            .then(function (res) {
              if (!res.ok) {
                tamperWarn.classList.remove("hidden");
                letterBody.textContent = res.text;
              } else {
                tamperWarn.classList.add("hidden");
                letterBody.textContent = res.text;
              }
            })
            .catch(function (e) {
              letterBody.innerHTML = '<p class="placeholder">解密失败:' + (e && e.message ? e.message : e) + "</p>";
            });
        })
        .catch(function (e) {
          letterBody.innerHTML = '<p class="placeholder">读取密钥失败:' + (e && e.message ? e.message : e) + "</p>";
        });
    } else {
      showLocked(data);
    }
  }

  function openLetter() {
    if (!API) {
      alert("前端尚未配置 SCF 接口地址。请部署后端后,在 config.js 填入访问地址(或加 ?api= 临时指定)。");
      return;
    }
    logBehavior("open_envelope");
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
        showOk("已加密保存。指纹:" + res.j.hash.slice(0, 16) + "…");
        state.hasLetter = true;
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

  function viewLogs() {
    var token = tokenInput.value.trim();
    if (!token) { showError("请先输入管理口令"); return; }
    logsBtn.disabled = true;
    fetch(apiUrl("/admin/logs"), { headers: { "X-Admin-Token": token } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j.error || "读取失败");
        var logs = res.j.logs || [];
        if (!logs.length) { logsBox.innerHTML = '<p class="logs-empty">暂无访问记录。</p>'; return; }
        var rows = logs.slice().reverse().map(function (l) {
          var d = new Date((l.ts || 0) * 1000);
          var beh = l.behavior === "open" ? "打开页面" : l.behavior === "open_envelope" ? "点击信封" : (l.behavior || "?");
          return '<li><span class="lt">' + d.toLocaleString() + '</span>' +
            '<span class="lb">' + beh + '</span>' +
            '<span class="lip">' + (l.ip || "") + '</span></li>';
        }).join("");
        logsBox.innerHTML = '<p class="logs-count">共 ' + logs.length + ' 条记录</p><ul class="logs-list">' + rows + "</ul>";
      })
      .catch(function (e) { showError("读取失败:" + e.message); })
      .finally(function () { logsBtn.disabled = false; });
  }

  // ---- 事件 ----
  $("openBtn").addEventListener("click", openLetter);
  adminFab.addEventListener("click", function () {
    tokenInput.value = sessionStorage.getItem("fl_token") || "";
    contentInput.value = state.hasLetter ? "(已加密保存,重新保存将覆盖)" : "";
    adminMsg.textContent = "";
    adminMsg.className = "modal-msg";
    logsBox.innerHTML = "";
    adminModal.classList.remove("hidden");
  });
  closeBtn.addEventListener("click", function () { adminModal.classList.add("hidden"); });
  saveBtn.addEventListener("click", saveLetter);
  lockBtn.addEventListener("click", lockLetter);
  logsBtn.addEventListener("click", viewLogs);
  adminModal.addEventListener("click", function (e) {
    if (e.target === adminModal) adminModal.classList.add("hidden");
  });

  // 页面加载即记录一次"打开页面"
  logBehavior("open");
})();
