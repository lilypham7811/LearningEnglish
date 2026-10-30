// Recipients for "📨 Gửi … cho <name>": a name and that learner's sync token. The token is checked here (who
// it belongs to, which shadow-english-sync… repo it can open) and kept in this Chrome only.
const $ = (id) => document.getElementById(id);

async function gh(token, path) {
  return fetch("https://api.github.com" + path, {
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
}
// The learner's repo: a private repo named shadow-english-sync… that this token can open (same rule as the app).
async function findHome(token) {
  const u = await gh(token, "/user");
  if (u.status === 401) throw new Error("Mã không đúng hoặc đã hết hạn.");
  if (!u.ok) throw new Error(`GitHub báo lỗi ${u.status}.`);
  const login = (await u.json()).login;
  const r = await gh(token, "/user/repos?per_page=100&sort=updated");
  if (!r.ok) throw new Error(`GitHub báo lỗi ${r.status}.`);
  const listed = (await r.json()).map((x) => x.full_name).filter((n) => /\/shadow-english-sync[\w.-]*$/i.test(n));
  const open = [];
  for (const n of listed) if ((await gh(token, `/repos/${n}`)).ok) open.push(n);
  if (!open.length) throw new Error("Mã này chưa được cấp quyền cho kho shadow-english-sync… nào.");
  return open.length === 1 ? open[0] : open.find((n) => n.toLowerCase() === `${login}/shadow-english-sync`.toLowerCase()) || open[0];
}

async function load() { return (await chrome.storage.local.get("recipients")).recipients || []; }
async function render() {
  const list = await load();
  $("none").hidden = list.length > 0;
  $("list").innerHTML = "";
  list.forEach((r, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<div><b></b><br><small></small></div><button class="ghost" type="button">Xoá</button>`;
    li.querySelector("b").textContent = r.name;
    li.querySelector("small").textContent = "kho " + r.home;
    li.querySelector("button").onclick = async () => {
      const all = await load();
      all.splice(i, 1);
      await chrome.storage.local.set({ recipients: all });
      render();
    };
    $("list").append(li);
  });
}

$("add").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("name").value.trim(), token = $("token").value.replace(/\s+/g, "");
  const msg = $("msg");
  msg.className = "msg";
  msg.textContent = "Đang kiểm tra với GitHub…";
  try {
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(token)) throw new Error("Mã không đúng dạng (phải bắt đầu bằng github_pat_).");
    const home = await findHome(token);
    const all = (await load()).filter((r) => r.name.toLowerCase() !== name.toLowerCase());
    all.push({ name, token, home });
    await chrome.storage.local.set({ recipients: all });
    msg.className = "msg ok";
    msg.textContent = `✓ Đã thêm ${name}: gửi vào kho ${home}. Bấm chuột phải trên một bài báo để thử.`;
    $("add").reset();
    render();
  } catch (err) {
    msg.className = "msg bad";
    msg.textContent = "⚠ " + (err.message || "Không kết nối được GitHub.");
  }
};
render();
