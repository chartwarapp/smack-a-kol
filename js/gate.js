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
  // Early-access signup: the repost step links here. LT: swap in the exact
  // pinned-post URL when handy — until then it points at the @smackakol
  // profile, where the pinned post sits at the top.
  var PINNED_POST_URL = 'https://x.com/smackakol';
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
    var css = '#sak-gate{position:fixed;inset:0;z-index:999999;display:flex;overflow-y:auto;padding:28px 24px 48px;background:#1b0a40 radial-gradient(circle at 50% 0%,#ff3b5c2e 0%,transparent 55%),radial-gradient(circle at 50% 30%,#4a1aa8 0%,#1b0a40 70%);font-family:"Lilita One","Arial Black",system-ui,sans-serif;color:#fff;text-align:center}' +
      '.sak-gate-card{width:100%;max-width:380px;margin:auto}' +
      '.sak-gate-hand{width:132px;border:3px solid #ffd23f;border-radius:24px;box-shadow:0 8px 30px rgba(0,0,0,.45);display:block;margin:0 auto 12px}' +
      '.sak-gate-card h1{font-size:46px;line-height:1;margin:0 0 8px;color:#ffd23f;text-shadow:2px 2px 0 #1a0b3a,-2px 2px 0 #1a0b3a,2px -2px 0 #1a0b3a,-2px -2px 0 #1a0b3a,0 5px 0 #c89000,0 10px 18px rgba(0,0,0,.55)}' +
      '.sak-gate-beta{display:inline-block;font-size:14px;letter-spacing:3px;padding:5px 14px;border:2px solid #fff;border-radius:999px;margin-bottom:18px}' +
      '.sak-gate-card p{font-size:18px;margin:0 0 16px;color:#e7e2f5}' +
      '#sak-gate-input{width:100%;padding:14px;font-family:inherit;font-size:22px;text-align:center;letter-spacing:2px;color:#fff;background:#24105c;border:2px solid #8a4dff;border-radius:14px;outline:none;text-transform:uppercase;box-sizing:border-box}' +
      '#sak-gate-input:focus{border-color:#ffd23f}' +
      '#sak-gate-btn{width:100%;margin-top:12px;padding:14px;font-family:inherit;font-size:20px;letter-spacing:1px;color:#1a0b3a;background:#ffd23f;border:0;border-radius:14px;cursor:pointer}' +
      '#sak-gate-btn:disabled{opacity:.6}' +
      '#sak-gate-err{margin-top:12px;color:#ff3b5c;font-size:17px}' +
      '.sak-gate-div{display:flex;align-items:center;gap:12px;margin:24px 0 16px;color:#e7e2f5;font-size:15px;letter-spacing:2px}' +
      '.sak-gate-div:before,.sak-gate-div:after{content:"";flex:1;height:2px;background:#8a4dff66}' +
      '.sak-gate-early{background:#24105c;border:2px solid #8a4dff;border-radius:16px;padding:18px 16px}' +
      '.sak-gate-early-title{font-size:24px;color:#ffd23f;letter-spacing:1px;margin-bottom:8px}' +
      '.sak-gate-step{font-size:16px!important;margin-bottom:12px!important}' +
      '.sak-gate-xbtn{display:inline-block;padding:10px 18px;margin-bottom:14px;background:#000;color:#fff;border:2px solid #fff;border-radius:999px;text-decoration:none;font-size:16px;letter-spacing:1px}' +
      '.sak-gate-field{width:100%;padding:12px;font-family:inherit;font-size:17px;color:#fff;background:#1b0a40;border:2px solid #8a4dff;border-radius:12px;outline:none;margin-bottom:10px;box-sizing:border-box}' +
      '.sak-gate-field:focus{border-color:#ffd23f}' +
      '.sak-gate-check{display:flex;gap:8px;align-items:flex-start;text-align:left;font-size:15px;color:#e7e2f5;margin:2px 0 12px;cursor:pointer}' +
      '.sak-gate-check input{width:18px;height:18px;margin-top:1px;accent-color:#ffd23f;flex:none}' +
      '#sak-gate-early-btn{width:100%;padding:14px;font-family:inherit;font-size:19px;letter-spacing:1px;color:#1a0b3a;background:#ffd23f;border:0;border-radius:14px;cursor:pointer}' +
      '#sak-gate-early-btn:disabled{opacity:.6}' +
      '#sak-gate-early-msg{margin-top:12px;font-size:16px}' +
      '.sak-gate-fine{font-size:13px!important;color:#e7e2f5b3!important;margin:12px 0 0!important}' +
      '@keyframes sak-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}' +
      '.sak-shake{animation:sak-shake .4s}';
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    var gate = document.createElement('div');
    gate.id = 'sak-gate';
    gate.innerHTML =
      '<div class="sak-gate-card">' +
        '<img class="sak-gate-hand" src="assets/hand-mascot.png" alt="Smack-a-KOL hand mascot" />' +
        '<h1>SMACK-A-KOL</h1>' +
        '<div class="sak-gate-beta">CLOSED BETA</div>' +
        '<p>Enter the passcode to test the game.</p>' +
        '<input id="sak-gate-input" type="text" autocomplete="off" autocapitalize="characters" placeholder="Passcode" />' +
        '<button id="sak-gate-btn">ENTER THE RING</button>' +
        '<div id="sak-gate-err" hidden>Wrong code — try again.</div>' +
        '<div class="sak-gate-div"><span>DON\'T HAVE A CODE?</span></div>' +
        '<div class="sak-gate-early">' +
          '<div class="sak-gate-early-title">GET EARLY ACCESS</div>' +
          '<p class="sak-gate-step">1. Repost our pinned post on X, then sign up below.</p>' +
          '<a class="sak-gate-xbtn" href="' + PINNED_POST_URL + '" target="_blank" rel="noopener">↗ REPOST THE PINNED POST</a>' +
          '<input id="sak-gate-x" class="sak-gate-field" type="text" autocomplete="off" autocapitalize="off" placeholder="@yourhandle" />' +
          '<input id="sak-gate-wallet" class="sak-gate-field" type="text" autocomplete="off" autocapitalize="off" placeholder="Solana wallet address" />' +
          '<label class="sak-gate-check"><input id="sak-gate-reposted" type="checkbox" /><span>I reposted the pinned post</span></label>' +
          '<button id="sak-gate-early-btn">SIGN UP FOR EARLY ACCESS</button>' +
          '<div id="sak-gate-early-msg" hidden></div>' +
          '<p class="sak-gate-fine">Early-access codes are DM\'d on X after we confirm your repost.</p>' +
        '</div>' +
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

    // Early-access signup (LT 2026-10-27): X handle + wallet + a repost
    // confirmation, stored in Supabase early_access_signups. Reposts are
    // confirmed by hand before codes go out by DM — the static page has
    // no X API access to verify a repost itself, so the form records the
    // handle and the confirmation instead of pretending to check it.
    // If the table is not deployed yet, the form says so instead of
    // showing a raw error.
    var xInput = document.getElementById('sak-gate-x');
    var wInput = document.getElementById('sak-gate-wallet');
    var rpCheck = document.getElementById('sak-gate-reposted');
    var earlyBtn = document.getElementById('sak-gate-early-btn');
    var earlyMsg = document.getElementById('sak-gate-early-msg');
    function earlySay(msg, ok) {
      earlyMsg.textContent = msg;
      earlyMsg.style.color = ok ? '#39ff88' : '#ff3b5c';
      earlyMsg.hidden = false;
    }
    earlyBtn.addEventListener('click', async function () {
      var handle = (xInput.value || '').trim().replace(/^@/, '');
      var wallet = (wInput.value || '').trim();
      if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) { earlySay('Enter a valid X handle (letters, numbers, underscore).'); xInput.focus(); return; }
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) { earlySay('Enter a valid Solana wallet address.'); wInput.focus(); return; }
      if (!rpCheck.checked) { earlySay('Tick the box to confirm you reposted the pinned post.'); return; }
      earlyBtn.disabled = true;
      earlyBtn.textContent = 'SIGNING UP…';
      earlyMsg.hidden = true;
      try {
        var B = backend();
        var r = await fetch(B.url.replace(/\/$/, '') + '/rest/v1/early_access_signups', {
          method: 'POST',
          headers: {
            'apikey': B.anonKey,
            'Authorization': 'Bearer ' + B.anonKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ x_handle: handle, wallet: wallet, reposted: true }),
        });
        if (r.status === 409) earlySay('You are already on the list — watch your X DMs.');
        else if (r.ok) {
          earlySay('You are on the list! We will DM your code on X after a quick check.', true);
          xInput.value = ''; wInput.value = ''; rpCheck.checked = false;
        }
        else if (r.status === 404) earlySay('Signups are not open yet — check back soon.');
        else earlySay('Could not save right now — try again.');
      } catch (e) {
        earlySay('Could not save right now — check connection and try again.');
      }
      earlyBtn.disabled = false;
      earlyBtn.textContent = 'SIGN UP FOR EARLY ACCESS';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
