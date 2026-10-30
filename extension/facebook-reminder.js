// A pause before Facebook: each time Facebook opens, a full-screen reminder of what the time could be used for.
// "Dừng lại" goes to the English app instead; "Xem tiếp" is ready after 5 seconds and the reminder comes back
// after 10 minutes. Drawn inside a shadow root so Facebook's styles can't change it.
(() => {
  if (window.top !== window || window.__seFacebookReminder) return;
  window.__seFacebookReminder = true;

  const APP = "https://lilypham7811.github.io/LearningEnglish/";
  const WAIT = 5;              // seconds before "Xem tiếp" can be pressed
  const AGAIN = 10 * 60000;    // the reminder comes back after 10 minutes on Facebook

  function show() {
    if (document.getElementById("se-fb-reminder")) return;
    const host = document.createElement("div");
    host.id = "se-fb-reminder";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      :host { all: initial; }
      .wrap { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 24px 16px;
        background: rgba(18, 38, 28, .9); backdrop-filter: blur(8px); font-family: "Segoe UI", system-ui, -apple-system, sans-serif; }
      .card { max-width: 560px; background: #fff; color: #10404e; border-radius: 20px; padding: 32px 28px; text-align: center;
        box-shadow: 0 20px 60px rgba(0, 0, 0, .35); }
      h1 { margin: 0 0 18px; font-size: 30px; line-height: 1.2; color: #e8640a; }
      p { margin: 0 0 12px; font-size: 18px; line-height: 1.5; }
      .acts { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-top: 24px; }
      button { font: inherit; font-size: 16px; font-weight: 700; border-radius: 12px; padding: 12px 20px; cursor: pointer; border: 2px solid #1f3b2d; }
      .stop { background: #1f3b2d; color: #fff; }
      .go { background: #fff; color: #1f3b2d; }
      .go:disabled { opacity: .45; cursor: default; }
    </style>
    <div class="wrap" role="dialog" aria-modal="true" aria-label="Nhắc nhở trước khi xem Facebook">
      <div class="card">
        <h1>Hãy dừng lại trước khi quá muộn.</h1>
        <p>30 phút lướt Facebook đủ để bạn tập luyện cho toàn thân khoẻ mạnh, sảng khoái.</p>
        <p>1–2 tiếng lướt Facebook mỗi ngày, rèn luyện suốt 365 ngày, đủ để bạn có một kỹ năng đỉnh cao.</p>
        <div class="acts">
          <button class="stop" type="button">✋ Dừng lại, học tiếng Anh</button>
          <button class="go" type="button" disabled>Xem tiếp (${WAIT})</button>
        </div>
      </div>
    </div>`;
    document.documentElement.append(host);
    const go = root.querySelector(".go");
    let left = WAIT;
    const tick = setInterval(() => {
      left--;
      if (left > 0) { go.textContent = `Xem tiếp (${left})`; return; }
      clearInterval(tick);
      go.disabled = false;
      go.textContent = "Xem tiếp 10 phút";
    }, 1000);
    root.querySelector(".stop").onclick = () => { location.href = APP; };
    go.onclick = () => {
      host.remove();
      setTimeout(show, AGAIN);
    };
  }
  show();
})();
