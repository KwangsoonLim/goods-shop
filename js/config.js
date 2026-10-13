// 공개돼도 괜찮은 값만 여기에 둔다.
// (Supabase publishable 키는 RLS 보안 규칙으로 보호되고, 토스 client 키는 원래 브라우저용이다.)
// 시크릿 키(Supabase service role, 토스 secret)는 절대 여기에 넣지 말 것.
window.APP_CONFIG = {
  SUPABASE_URL: "https://hbtnekuwkfhlcsoxbguq.supabase.co",
  SUPABASE_KEY: "sb_publishable_4QBtjK-LnMlyJ5iVwu-y-g_gD2es3dw",
  // 토스페이먼츠 결제위젯 '문서용 공개 테스트 키' — 실제 돈이 나가지 않는다.
  TOSS_CLIENT_KEY: "test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm",
};
