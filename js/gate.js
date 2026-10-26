/* =========================================================================
 * Smack-a-KOL — closed-beta passcode gate (LT, 2026-10-26).
 * A client-side velvet rope, not a vault: it stops accidental visitors
 * from wandering into the game while it is still in testing. It does NOT
 * stop a determined bypass (the game repo is public, so the files are
 * readable anyway) — real server-side auth is the later step if wanted.
 *
 * How it works: one shared CODE below. The device stores only a hash of
 * the code, so changing CODE re-asks every device (old unlocks stop
 * matching). Unlock persists in localStorage, so testers enter it once
 * per device. Loaded FIRST in <head> on index.html + play.html so the
 * page content is hidden before anything paints; challenge.html needs
 * no copy — it redirects to play.html, which is gated.
 * ========================================================================= */
(function () {
  var CODE = 'SMACKTIME'; // <-- change this one word to rotate the code
  var KEY = 'sak_gate_v1';

  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'g' + (h >>> 0).toString(36);
  }
  function norm(s) { return (s || '').trim().toUpperCase(); }

  try {
    if (localStorage.getItem(KEY) === hash(CODE)) return; // already unlocked
  } catch (e) { /* storage unavailable -> fall through to the gate */ }

  // Hide everything immediately so nothing flashes behind the gate.
  // The gate itself is appended to <html> (not <body>), so this rule
  // never hides it.
  var hide = document.createElement('style');
  hide.id = 'sak-gate-hide';
  hide.textContent = 'html,body{background:#1b0a40} body>*{display:none!important}';
  document.head.appendChild(hide);

  function build() {
    var css = '#sak-gate{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;padding:24px;background:#1b0a40 radial-gradient(circle at 50% 30%,#4a1aa8 0%,#1b0a40 70%);font-family:"Lilita One","Arial Black",system-ui,sans-serif;color:#fff;text-align:center}' +
      '.sak-gate-card{width:100%;max-width:340px}' +
      '.sak-gate-card h1{font-size:44px;line-height:1;margin:0 0 8px;color:#ffd23f;text-shadow:2px 2px 0 #1a0b3a,-2px 2px 0 #1a0b3a,2px -2px 0 #1a0b3a,-2px -2px 0 #1a0b3a}' +
      '.sak-gate-beta{display:inline-block;font-size:14px;letter-spacing:3px;padding:5px 14px;border:2px solid #fff;border-radius:999px;margin-bottom:18px}' +
      '.sak-gate-card p{font-size:18px;margin:0 0 16px;color:#e7e2f5}' +
      '#sak-gate-input{width:100%;padding:14px;font-family:inherit;font-size:22px;text-align:center;letter-spacing:2px;color:#fff;background:#24105c;border:2px solid #8a4dff;border-radius:14px;outline:none;text-transform:uppercase}' +
      '#sak-gate-input:focus{border-color:#ffd23f}' +
      '#sak-gate-btn{width:100%;margin-top:12px;padding:14px;font-family:inherit;font-size:20px;letter-spacing:1px;color:#1a0b3a;background:#ffd23f;border:0;border-radius:14px;cursor:pointer}' +
      '#sak-gate-err{margin-top:12px;color:#ff3b5c;font-size:17px}' +
      '@keyframes sak-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}' +
      '.sak-shake{animation:sak-shake .4s}';
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    var gate = document.createElement('div');
    gate.id = 'sak-gate';
    gate.innerHTML =
      '<div class="sak-gate-card">' +
        '<h1>SMACK-A-KOL</h1>' +
        '<div class="sak-gate-beta">CLOSED BETA</div>' +
        '<p>Enter the passcode to test the game.</p>' +
        '<input id="sak-gate-input" type="text" autocomplete="off" autocapitalize="characters" placeholder="Passcode" />' +
        '<button id="sak-gate-btn">ENTER THE RING</button>' +
        '<div id="sak-gate-err" hidden>Wrong code — try again.</div>' +
      '</div>';
    document.documentElement.appendChild(gate);

    var input = document.getElementById('sak-gate-input');
    var err = document.getElementById('sak-gate-err');
    function submit() {
      if (norm(input.value) === CODE) {
        try { localStorage.setItem(KEY, hash(CODE)); } catch (e) { try { sessionStorage.setItem(KEY, hash(CODE)); } catch (e2) {} }
        location.reload(); // clean boot with the gate satisfied
      } else {
        err.hidden = false;
        input.value = '';
        gate.classList.remove('sak-shake');
        void gate.offsetWidth; // restart the shake
        gate.classList.add('sak-shake');
        input.focus();
      }
    }
    document.getElementById('sak-gate-btn').addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    input.focus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
