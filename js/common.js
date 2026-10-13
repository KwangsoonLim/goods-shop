// 모든 페이지가 함께 쓰는 기능: Supabase 연결, 로그인 확인, 상단 메뉴, 표시 형식.
const { SUPABASE_URL, SUPABASE_KEY } = window.APP_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function getUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

async function isAdmin() {
  const { data } = await sb.rpc("is_admin");
  return data === true;
}

// 로그인 안 했으면 로그인 페이지로 보냈다가, 로그인 후 원래 페이지로 돌아오게 한다.
async function requireLogin() {
  const user = await getUser();
  if (!user) {
    const next = location.pathname.split("/").pop() || "index.html";
    location.replace("login.html?next=" + encodeURIComponent(next + location.search));
    return null;
  }
  return user;
}

async function renderHeader(active) {
  const el = document.getElementById("site-header");
  if (!el) return;
  const user = await getUser();
  const admin = user ? await isAdmin() : false;
  const link = (href, label, key) =>
    `<a href="${href}" class="${active === key ? "active" : ""}">${label}</a>`;
  el.innerHTML = `
    <div class="header-inner">
      <a href="index.html" class="brand"><span class="brand-mark">G</span>굿즈샵</a>
      <nav>
        ${link("index.html", "상품", "home")}
        ${user ? link("orders.html", "내 결제 내역", "orders") : ""}
        ${admin ? link("admin.html", "관리자", "admin") : ""}
        ${user
          ? `<span class="who" title="${escapeHtml(user.email)}">${escapeHtml(user.email)}</span>
             <button type="button" class="btn-ghost" id="logout-btn">로그아웃</button>`
          : link("login.html", "로그인", "login")}
      </nav>
    </div>`;
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await sb.auth.signOut();
    location.href = "index.html";
  });
}

const won = (n) => Number(n).toLocaleString("ko-KR") + "원";

const fmtDate = (s) => s ? new Date(s).toLocaleString("ko-KR", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
}) : "-";

const STATUS = {
  paid:    { label: "결제 완료", cls: "paid" },
  pending: { label: "결제 대기", cls: "pending" },
  failed:  { label: "결제 실패", cls: "failed" },
};
const statusBadge = (s) =>
  `<span class="badge ${STATUS[s]?.cls ?? ""}">${STATUS[s]?.label ?? s}</span>`;

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
