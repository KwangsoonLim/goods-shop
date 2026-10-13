// 결제 승인 서버 함수.
// success.html 이 { paymentKey, orderId, amount } 와 로그인 토큰을 보내면
//   1) 주문이 본인 것인지, 금액이 DB 금액과 같은지 확인하고
//   2) 토스 결제 승인 API를 호출한 뒤
//   3) 주문을 paid 로 바꾼다.
// 토스 시크릿 키(TOSS_SECRET_KEY)는 Supabase secrets 에만 있고 브라우저로 나가지 않는다.
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

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 1. 로그인 사용자 확인
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ message: "로그인이 필요합니다." }, 401);

  let body: { paymentKey?: string; orderId?: string; amount?: number | string };
  try { body = await req.json(); } catch { return json({ message: "잘못된 요청입니다." }, 400); }
  const { paymentKey, orderId } = body;
  const amount = Number(body.amount);
  if (!paymentKey || !orderId || !Number.isFinite(amount)) return json({ message: "결제 정보가 부족합니다." }, 400);

  // 2. 주문 확인
  const { data: order } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order || order.user_id !== userData.user.id) return json({ message: "주문을 찾을 수 없습니다." }, 404);
  if (order.status === "paid") return json({ order });               // 새로고침 등으로 다시 호출된 경우
  if (order.amount !== amount) return json({ message: "결제 금액이 주문 금액과 다릅니다." }, 400);

  // 3. 토스 결제 승인
  const secret = Deno.env.get("TOSS_SECRET_KEY")!;
  const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(secret + ":"), "Content-Type": "application/json" },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });
  const toss = await tossRes.json();
  if (!tossRes.ok) {
    await admin.from("orders").update({ status: "failed" }).eq("id", orderId).eq("status", "pending");
    return json({ message: toss.message ?? "결제 승인에 실패했습니다.", code: toss.code }, 400);
  }

  // 4. 주문 완료 처리
  const { data: paid, error: updErr } = await admin.from("orders")
    .update({ status: "paid", payment_key: paymentKey, paid_at: toss.approvedAt ?? new Date().toISOString() })
    .eq("id", orderId).select().single();
  if (updErr) return json({ message: "결제는 승인됐지만 주문 저장에 실패했습니다. 관리자에게 문의하세요." }, 500);

  return json({ order: paid });
});
