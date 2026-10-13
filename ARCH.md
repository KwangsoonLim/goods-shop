# ARCH.md — goods-shop 구조

## 전체 그림

```
[브라우저: GitHub Pages 정적 파일]
   │  supabase-js (publishable 키 + 로그인 토큰)
   ├──▶ Supabase Auth ........ 회원가입/로그인 (이메일 인증 없음)
   ├──▶ Supabase DB (REST) ... products 조회, orders 생성·조회 (RLS로 보호)
   ├──▶ Edge Function confirm-payment ── TOSS_SECRET_KEY ──▶ 토스 결제 승인 API
   │
   └──▶ 토스 결제위젯 SDK v2 (client 키) ── 결제창 ──▶ success.html / fail.html 로 복귀
```

서버 코드는 Edge Function 하나뿐이다. 나머지는 브라우저가 Supabase를 직접 호출하고, 그 접근 범위는 DB의 RLS(행 단위 보안 규칙)가 제한한다.

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 상품 카드 목록. "구매하기"를 누르면 로그인을 확인한 뒤 결제 모달을 연다. 수량을 바꾸면 `widgets.setAmount`, "결제하기"를 누르면 주문 생성 후 `widgets.requestPayment`를 호출한다. |
| `login.html` | 로그인/회원가입 탭. `?next=`가 있으면 로그인 후 그 페이지로 돌아간다. 관리자는 `admin.html`로, 나머지는 `index.html`로 이동한다. |
| `success.html` | URL의 `paymentKey/orderId/amount`를 `confirm-payment`로 보내 최종 승인을 받는다. 승인 뒤 `history.replaceState`로 URL 파라미터를 지워서 새로고침해도 다시 요청하지 않게 한다. |
| `fail.html` | 토스가 넘겨준 `code/message/orderId`를 보여준다. |
| `orders.html` | 내 주문 목록 (`user_id = 나`). |
| `admin.html` | `is_admin()` 결과가 false면 차단한다. 관리자에게는 전체 주문, 구매자 이메일, 합계, 상태 필터, 검색을 보여준다. |
| `js/config.js` | 공개 키(Supabase URL/publishable 키, 토스 client 키) |
| `js/common.js` | `sb` 클라이언트, `getUser`, `isAdmin`, `requireLogin`, `renderHeader`, `won`, `fmtDate`, `statusBadge`, `escapeHtml` |
| `css/style.css` | 색은 `:root` 변수로 둔다. CTA는 `.btn-cta`(주황). 640px 이하 화면에서는 표가 카드 형태로 바뀐다. |
| `supabase/schema.sql` | 테이블, 함수, 트리거, RLS, 예시 상품. 여러 번 실행해도 안전하다. |
| `supabase/functions/confirm-payment/index.ts` | 결제 승인 Edge Function |

## 결제 흐름

1. 사용자가 상품과 수량을 고르고 "결제하기"를 누른다.
2. 브라우저가 `orders`에 `insert {product_id, quantity}`를 보낸다.
   - 트리거 `prepare_order`가 `user_id`, `amount`(상품가 × 수량), `order_name`, `status='pending'`을 DB에서 직접 채운다. 브라우저가 보낸 금액은 무시한다.
3. 브라우저가 DB가 계산한 금액으로 `widgets.setAmount`를 다시 설정하고, `requestPayment({orderId: 주문 uuid, ...})`로 토스 결제창을 연다.
4. 결제창에서 인증이 끝나면 `success.html?paymentKey&orderId&amount`로 돌아온다. 아직 승인 전 상태다.
5. `success.html`이 `confirm-payment`를 호출한다. 함수는 다음 순서로 처리한다.
   1. JWT로 로그인한 사용자를 확인한다.
   2. 주문이 본인 것인지 확인한다. 이미 `paid`이면 그대로 돌려준다.
   3. DB 금액과 요청 금액이 같은지 확인한다.
   4. 토스 `POST /v1/payments/confirm`을 `Basic base64(secret + ":")` 인증으로 호출한다.
   5. 성공하면 `status='paid'`, `payment_key`, `paid_at`을 저장한다. 실패하면 `status='failed'`로 바꾸고 토스 메시지를 돌려준다.
6. 사용자가 결제창을 닫으면 주문은 `pending`으로 남는다. 화면에는 "결제 대기"로 표시되고, 돈은 나가지 않는다.

## DB

| 테이블 | 주요 컬럼 | RLS |
|---|---|---|
| `products` | id, name, description, price, emoji, color | 누구나 SELECT |
| `profiles` | id(=auth.users.id), email, is_admin | 본인 또는 관리자 SELECT. 가입 시 트리거 `handle_new_user`가 자동 생성한다. |
| `orders` | id(uuid, 토스 orderId로 사용), user_id, product_id, quantity, amount, order_name, status(pending/paid/failed), payment_key, created_at, paid_at | 본인 또는 관리자 SELECT, 본인 INSERT. UPDATE/DELETE 정책이 없으므로 상태는 service role(Edge Function)만 바꿀 수 있다. |

- `is_admin()`: `security definer` 함수로, `profiles.is_admin`을 읽는다. RLS 정책 안과 프론트(`sb.rpc('is_admin')`)에서 함께 쓴다.
- 관리자 지정: `update profiles set is_admin = true where email = '...'`

## 설정값

- Auth: `mailer_autoconfirm = true`, `site_url = https://kwangsoonlim.github.io/goods-shop/`, 허용 리다이렉트 URL은 localhost:8765와 Pages 주소다.
- Edge Function: `verify_jwt = false`(게이트웨이 검증을 끄고 함수 안에서 `auth.getUser`로 확인한다), secret `TOSS_SECRET_KEY`.
- 토스 키: 문서용 공개 테스트 키(`test_gck_docs_…` / `test_gsk_docs_…`)를 쓴다. 실제 판매로 바꿀 때는 토스 가맹점 키로 교체한다. client 키는 `js/config.js`, 시크릿 키는 Supabase secret이다.
