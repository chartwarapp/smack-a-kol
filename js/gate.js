/* =========================================================================
 * Smack-a-KOL — closed-beta passcode gate (LT, 2026-10-26).
 * A client-side velvet rope, not a vault: it stops accidental visitors
 * from wandering into the game while it is still in testing. It does NOT
 * stop a determined bypass (the game repo is public, so the files are
 * readable anyway) — real server-side auth is the later step if wanted.
 *
 * Two kinds of code, both entered ONCE per device and then remembered:
 *   1. MASTER (CODE below, e.g. SMACKTIME): checked locally, works
 *      offline. Changing CODE re-asks every master-unlocked device,
 *      because the stored flag is a hash of the code.
 *   2. PERSONAL beta codes (8 chars, e.g. ABCD-1234): validated by the
 *      beta-codes Edge Function (Supabase), which checks the code hash
 *      against the beta_codes table. Codes STAY VALID after first use —
 *      a tester enters once, their device stores a 'beta:' flag, and
 *      the code keeps working on new devices. Revoking a code stops
 *      NEW devices only; already-unlocked devices stay unlocked.
 * Loaded FIRST in <head> on index.html + play.html so the page content
 * is hidden before anything paints; challenge.html needs no copy — it
 * redirects to play.html, which is gated.
 * ========================================================================= */
(function () {
  var CODE = 'SMACKTIME'; // <-- change this one word to rotate the master code
  var KEY = 'sak_gate_v1';

  // djb2 — kept for the MASTER flag (existing unlocked devices store
  // hash('SMACKTIME') under this function; changing it would re-ask them).
  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'g' + (h >>> 0).toString(36);
  }
  // Uppercase + strip dashes/spaces, so grouped codes (ABCD-1234) match.
  function norm(s) { return (s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  async function sha256hex(s) {
    try {
      var d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return [...new Uint8Array(d)].map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    } catch (e) { return hash(s); }
  }
  // Supabase backend: prefer the game's own config when loaded, else the
  // public-by-design project values (same as js/config.js).
  function backend() {
    try {
      var B = window.SAK && window.SAK.BACKEND;
      if (B && B.url && B.anonKey) return B;
    } catch (e) {}
    return { url: 'https://vmkdnkzhlhwdswvlhuvs.supabase.co', anonKey: 'sb_publishable_R2elzqKbX_nsgUtBlFHXzQ_gFG_8uw_' };
  }

  function isUnlocked() {
    try {
      var v = localStorage.getItem(KEY);
      return v === hash(CODE) || (!!v && v.indexOf('beta:') === 0);
    } catch (e) { return false; }
  }
  if (isUnlocked()) return; // already unlocked

  // Hide everything immediately so nothing flashes behind the gate.
  // The gate itself is appended to <html> (not <body>), so this rule
  // never hides it.
  var hide = document.createElement('style');
  hide.id = 'sak-gate-hide';
  hide.textContent = 'html,body{background:#1b0a40} body>*{display:none!important}';
  document.head.appendChild(hide);

  function storeFlag(value) {
    try { localStorage.setItem(KEY, value); }
    catch (e) { try { sessionStorage.setItem(KEY, value); } catch (e2) {} }
  }

  function build() {
    var css = '#sak-gate{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;padding:24px;background:#1b0a40 radial-gradient(circle at 50% 30%,#4a1aa8 0%,#1b0a40 70%);font-family:"Lilita One","Arial Black",system-ui,sans-serif;color:#fff;text-align:center}' +
      '.sak-gate-card{width:100%;max-width:340px}' +
      '.sak-gate-card h1{font-size:44px;line-height:1;margin:0 0 8px;color:#ffd23f;text-shadow:2px 2px 0 #1a0b3a,-2px 2px 0 #1a0b3a,2px -2px 0 #1a0b3a,-2px -2px 0 #1a0b3a}' +
      '.sak-gate-beta{display:inline-block;font-size:14px;letter-spacing:3px;padding:5px 14px;border:2px solid #fff;border-radius:999px;margin-bottom:18px}' +
      '.sak-gate-card p{font-size:18px;margin:0 0 16px;color:#e7e2f5}' +
      '#sak-gate-input{width:100%;padding:14px;font-family:inherit;font-size:22px;text-align:center;letter-spacing:2px;color:#fff;background:#24105c;border:2px solid #8a4dff;border-radius:14px;outline:none;text-transform:uppercase}' +
      '#sak-gate-input:focus{border-color:#ffd23f}' +
      '#sak-gate-btn{width:100%;margin-top:12px;padding:14px;font-family:inherit;font-size:20px;letter-spacing:1px;color:#1a0b3a;background:#ffd23f;border:0;border-radius:14px;cursor:pointer}' +
      '#sak-gate-btn:disabled{opacity:.6}' +
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
    var btn = document.getElementById('sak-gate-btn');
    var err = document.getElementById('sak-gate-err');
    function fail(msg) {
      err.textContent = msg;
      err.hidden = false;
      input.value = '';
      gate.classList.remove('sak-shake');
      void gate.offsetWidth; // restart the shake
      gate.classList.add('sak-shake');
      input.focus();
    }
    async function submit() {
      var code = norm(input.value);
      if (!code) { input.focus(); return; }
      // 1. Master code: local, offline, unchanged.
      if (code === CODE) {
        storeFlag(hash(CODE));
        location.reload(); // clean boot with the gate satisfied
        return;
      }
      // 2. Personal beta code: server-side check (hashes never leave the
      // backend; a wrong code and a revoked code both read as invalid).
      btn.disabled = true;
      btn.textContent = 'CHECKING…';
      err.hidden = true;
      try {
        var B = backend();
        var r = await fetch(B.url.replace(/\/$/, '') + '/functions/v1/beta-codes', {
          method: 'POST',
          headers: {
            'apikey': B.anonKey,
            'Authorization': 'Bearer ' + B.anonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'validate', code: code }),
        });
        var data = await r.json().catch(function () { return null; });
        if (r.ok && data && data.valid === true) {
          storeFlag('beta:' + await sha256hex(code));
          location.reload(); // clean boot with the gate satisfied
          return;
        }
        if (!r.ok) console.warn('[SAK] beta validate failed', r.status);
        fail('Wrong code — try again.');
      } catch (e) {
        console.warn('[SAK] beta validate error', e);
        fail("Can't verify right now — check connection and try again.");
      }
      btn.disabled = false;
      btn.textContent = 'ENTER THE RING';
    }
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    input.focus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
