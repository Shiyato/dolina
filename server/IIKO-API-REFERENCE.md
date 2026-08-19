# iikoCloud API — методы, важные для проекта

База: `https://api-ru.iiko.services`. Авторизация: `POST /api/v2/access_token`
{apiKey, appId, clientSecret} → JWT (1 час) → `Authorization: Bearer {token}`.
Все методы — POST, тело JSON, у всех есть `organizationId`.

## Лояльность (используем / пригодятся)

### customer/info — данные гостя + баланс
`POST /api/1/loyalty/iiko/customer/info` { organizationId, type:"phone", phone }
→ id, name, surname, phone, cards[].track, categories[], walletBalances[] (type 1 = бонусы).

### get_counters — покупки/сумма гостя за период ⭐
`POST /api/1/loyalty/iiko/get_counters`
{ guestIds:[uuid], periods:[…], metrics:[…], organizationId }
- **periods (СТРОКИ):** `AllTime`(0) `Day`(1) `Week`(2) `Month`(3) `Quarter`(4) `Year`(5)
- **metrics (СТРОКИ):** `OrdersCount` `OrdersSum`
- Ответ: counters[] { guestId, period(int), metric(int 1=OrdersSum, 2=OrdersCount), value }
- ВАЖНО: enum'ы в запросе передавать СТРОКАМИ, в ответе приходят числами.
- **Покупки за месяц** = period `Month`, metric `OrdersCount`.

### customer/transactions/by_date — история операций гостя ⭐
`POST /api/1/loyalty/iiko/customer/transactions/by_date`
{ customerId, dateFrom, dateTo (UTC "yyyy-MM-dd HH:mm:ss.fff"), pageNumber, pageSize, organizationId }
→ transactions[], pageSize, pageNumber. (Есть и by_revision.)
Даёт историю начислений/списаний БЕЗ вебхуков.

### Категории гостя
- `POST /api/1/loyalty/iiko/customer_category` { organizationId } → список категорий
- `POST /api/1/loyalty/iiko/customer_category/add` { customerId, categoryId, organizationId }
- `POST /api/1/loyalty/iiko/customer_category/remove` { customerId, categoryId, organizationId }
- ПРОЦЕНТ скидки/кэшбека категории через API НЕ меняется — только в iikoOffice/iikoWeb.
  Через API можно лишь назначать/снимать категорию гостю.

### Кошельки (начисление/списание)
- `wallet/topup` { customerId, walletId, sum, comment, organizationId } — начислить
- `wallet/chargeoff` { … } — списать
- `wallet/hold` / `wallet/cancel_hold` — удержание для оплаты на POS
- `customer/create_or_update`, `customer/program/add`, `customer/card/add|remove`

### Прочее лояльности
- `POST /api/1/loyalty/iiko/calculate` — расчёт скидок/бонусов для заказа
- `program` (GET), `manual_condition` (GET), `coupons/*`, `check_sms_*`, `message/send_sms|send_email`

## Организации
- `POST /api/1/organizations` { returnAdditionalInfo } → id, name, restaurantAddress, latitude, longitude
- `POST /api/1/organizations/settings` — параметры (Name, Country, RestaurantAddress, Latitude, Longitude…)

## Вебхуки (альтернатива для истории — но выше есть прямой метод)
- `POST /api/1/webhooks/update_settings` { organizationId, webHooksUri, authToken, webHooksFilter }
- `POST /api/1/webhooks/settings` — текущие настройки
- События: DeliveryOrderUpdate, TableOrderUpdate, ReserveUpdate, StopListUpdate, PersonalShift.

## Заметки
- OpenAPI-спека закрыта без токена (api-ru.iiko.services/api/1 → 404).
- Токен без refresh — перезапрашивать до истечения (кэшируем ~55 мин).
