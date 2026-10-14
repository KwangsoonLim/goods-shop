// 회원탈퇴 서버 함수.
// withdraw.html 이 { password } 와 로그인 토큰을 보내면
//   1) 로그인한 사람이 맞는지, 관리자가 아닌지 확인하고
//   2) 비밀번호를 한 번 더 확인한 뒤
//   3) 계정을 지운다. (profiles 는 함께 지워지고, orders 는 user_id 만 비워진 채 남는다)
// 계정 삭제는 service role 키가 있어야 해서 브라우저에서는 할 수 없다.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ message: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 1. 로그인 사용자 확인
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userErr || !user?.email) return json({ message: "로그인이 필요해요." }, 401);

  // 관리자가 탈퇴하면 관리자 페이지를 볼 사람이 없어지므로 막는다
  const { data: profile } = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (profile?.is_admin) return json({ message: "관리자 계정은 탈퇴할 수 없어요." }, 403);

  // 2. 비밀번호 다시 확인 (로그인된 채로 둔 기기에서 남이 탈퇴시키는 것을 막는다)
  let body: { password?: string };
  try { body = await req.json(); } catch { return json({ message: "잘못된 요청이에요." }, 400); }
  if (!body.password) return json({ message: "비밀번호를 입력해 주세요." }, 400);

  const publicKey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
  const checker = createClient(url, publicKey, { auth: { persistSession: false } });
  const { error: pwErr } = await checker.auth.signInWithPassword({ email: user.email, password: body.password });
  if (pwErr) return json({ message: "비밀번호가 맞지 않아요." }, 400);

  // 3. 계정 삭제
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) return json({ message: "탈퇴하지 못했어요. 다시 시도해 주세요." }, 500);

  return json({ ok: true });
});
