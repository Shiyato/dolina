# iikoCloud API (iikoTransport) — полный справочник методов

База: `https://api-ru.iiko.services`. Все методы — **POST**, тело JSON, ответ содержит
`correlationId`. Заголовки: `Authorization: Bearer {token}`, `Timeout` (сек, по умолч. 15).
Форматы: `uuid` — GUID; `date-time` — строка `yyyy-MM-dd HH:mm:ss.fff` (напр. `2018-01-01 01:01:30.123`).
Токен живёт 1 час (см. `exp` в JWT), refresh-flow нет — перезапрашивать до истечения.

Сохранено 2026-07-22 из документации, переданной заказчиком (ReDoc iikoCloud API).

---

## Authorization

- **`POST /api/1/access_token`** (Deprecated) — { apiLogin } → { correlationId, token }. Ключ из iikoWeb.
- **`POST /api/v2/access_token`** — { **apiKey**, **appId**(uuid), **clientSecret** } → { correlationId, token }.
  - Регистрация: портал разработчика (public-api.iikoweb.ru/portal / api.iiko.ru) → создать приложение → appId + clientSecret (secret показывается один раз).
  - apiKey генерируется в iikoWeb → «Integrations → API Keys». Определяет, к каким организациям есть доступ.

## Notifications
- **`POST /api/1/notifications/send`** — { orderSource, orderId, additionalInfo, messageType:"order_attention", organizationId }.

## Organizations
- **`POST /api/1/organizations`** — { organizationIds?, returnAdditionalInfo?, includeDisabled?, returnExternalData? } → organizations[] (id, name; при returnAdditionalInfo — version, country, restaurantAddress, latitude, longitude…).
- **`POST /api/1/organizations/settings`** — { organizationIds?, includeDisabled?, parameters[], returnExternalData? }. parameters enum: PricesVatInclusive, Version, AddressFormatType, Name, Country, RestaurantAddress, Latitude, Longitude, CurrencyIsoName, DeliveryServiceType, …

## Terminal groups
- **`POST /api/1/terminal_groups`** — { organizationIds, includeDisabled?, returnExternalData? } → terminalGroups[], terminalGroupsInSleep[].
- **`POST /api/1/terminal_groups/is_alive`** — { organizationIds, terminalGroupIds } → isAliveStatus[].
- **`POST /api/1/terminal_groups/awake`** — { organizationIds, terminalGroupIds } → successfullyProcessed[], failedProcessed[]. (Терминал надо «разбудить», иначе заказ не уедет.)

## Dictionaries
- **`POST /api/1/cancel_causes`** — { organizationIds } → cancelCauses[]. (v7.7.1+)
- **`POST /api/1/deliveries/order_types`** — { organizationIds } → orderTypes[].
- **`POST /api/1/discounts`** — { organizationIds } → discounts[] (скидки/наценки; только чтение).
- **`POST /api/1/payment_types`** — { organizationIds } → paymentTypes[].
- **`POST /api/1/removal_types`** — { organizationIds } → removalTypes[] (причины удаления; v7.5.3+).
- **`POST /api/1/tips_types`** — → tipsTypes[] (v7.7.4+).

## Menu
- **`POST /api/1/nomenclature`** — { organizationId, startRevision } → groups[], productCategories[], products[], sizes[], revision. (0 при первом запросе; если revision==startRevision — изменений нет.)
- **`POST /api/2/menu`** — → externalMenus[], priceCategories[] (внешние меню с ценовыми категориями).
- **`POST /api/2/menu/by_id`** — { externalMenuId, organizationIds, priceCategoryId?, version?, language? } → внешнее меню (itemCategories, comboCategories…).
- **`POST /api/1/stop_lists`** — { organizationIds, returnSize?, terminalGroupsIds? } → terminalGroupStopLists[] (стоп-листы).
- **`POST /api/1/stop_lists/check`** — { organizationId, terminalGroupId, items } → rejectedItems (что в стопе).
- **`POST /api/1/stop_lists/add`** / **`/remove`** / **`/clear`** — управление стоп-листом (нужны доп. права; v8.6.1+).
- **`POST /api/1/combo`** — { extraData?, organizationId } → comboSpecifications[], comboCategories[].
- **`POST /api/1/combo/calculate`** — { items, organizationId } → price, incorrectlyFilledGroups[].
- **Webhook `StopListUpdate`** — обновление стоп-листа.

## Operations
- **`POST /api/1/commands/status`** — { organizationId, correlationId } → { state: InProgress/… }. (Код 410 — correlationId больше не поддерживается.)

## Employees
- **`POST /api/1/employees/couriers/locations/by_time_offset`** — координаты курьеров за интервал.
- **`POST /api/1/employees/couriers`** — { organizationIds } → employees[] (курьеры).
- **`POST /api/1/employees/couriers/by_role`** — { organizationIds, rolesToCheck } → employeesWithCheckRoles[].
- **`POST /api/1/employees/couriers/active_location/by_terminal`** — активные курьеры на терминале.
- **`POST /api/1/employees/couriers/active_location`** — активные курьеры по организациям.
- **`POST /api/1/employees/info`** — { organizationId, id } → employeeInfo (firstName, lastName, email, phone…).
- **`POST /api/1/employees/shift/clockin`** / **`/clockout`** / **`/is_open`** — личная смена (команда, см. commands/status).
- **`POST /api/1/employees/shifts/by_courier`** — { employeeId } → terminalGroupIds[].
- **Webhook `PersonalShift`** — обновление личной смены.

## Deliveries: Create and update
Команды (проверять через commands/status):
- **`POST /api/1/deliveries/create`** — { organizationId, terminalGroupId?, createOrderSettings?, order } → orderInfo. Order содержит: phone, orderServiceType (DeliveryByCourier / DeliveryByClient=самовывоз), deliveryPoint, items, combos, payments, discountsInfo (card — трек карты скидки), loyaltyInfo, chequeAdditionalInfo, externalData.
- **`/change_external_data`**, **`/update_order_problem`**, **`/update_order_payments`**(deprecated), **`/update_order_delivery_status`** (Waiting/OnWay/Delivered), **`/update_order_courier`**(deprecated), **`/add_items`**, **`/close`**, **`/cancel`** (cancelCauseId, removalTypeId…), **`/change_complete_before`**, **`/change_delivery_point`**, **`/change_service_type`**, **`/change_payments`**, **`/change_comment`**, **`/print_delivery_bill`**, **`/confirm`**, **`/cancel_confirmation`**, **`/change_operator`**, **`/add_payments`**, **`/change_driver_info`**, **`/update_tracking_link`**.
- **`POST /api/1/order/print_bill`** — печать пречека.
- **Webhooks `DeliveryOrderUpdate`, `DeliveryOrderError`**.

## Deliveries: Retrieve
- **`POST /api/1/deliveries/by_id`** — { organizationId, orderIds? / posOrderIds? } (макс 200; гарант. доступность 7 дней, дальше — history).
- **`POST /api/1/deliveries/by_delivery_date_and_status`** — { organizationIds, deliveryDateFrom, deliveryDateTo?, statuses?, courierIds? }.
- **`POST /api/1/deliveries/by_revision`** — { startRevision, organizationIds } (макс сдвиг 3 часа).
- **`POST /api/1/deliveries/by_delivery_date_and_phone`** — по телефону/датам/ревизии.
- **`POST /api/1/deliveries/by_delivery_date_and_source_key_and_filter`** — поиск по тексту+фильтрам.
- **`POST /api/1/deliveries/history/by_delivery_date_and_phone`** — { phone, deliveryDateFrom?, deliveryDateTo?, organizationIds, rowsCount } (история до 90 дней).

## Addresses
- **`POST /api/1/regions`**, **`/api/1/cities`**, **`/api/1/streets/by_city`** { organizationId, cityId, includeDeleted? }, **`/api/1/streets/by_id`** { organizationId, ids?, classifierIds? }.

## Delivery restrictions
- **`POST /api/1/delivery_restrictions`** — { organizationIds } → deliveryRestrictions[] (v6.4.16+).
- **`POST /api/1/delivery_restrictions/allowed`** — { organizationIds, deliveryAddress/orderLocation, orderItems, isCourierDelivery, deliverySum… } → isAllowed, allowedItems[], rejectedItems[], location.

## Marketing sources
- **`POST /api/1/marketing_sources`** — { organizationIds } → marketingSources[] (v7.2.5+).

## Drafts (черновики заказов)
- **`/api/1/deliveries/drafts/by_id`**, **`/by_filter`**, **`/create`**, **`/save`**, **`/commit`** (отправить на Front), **`/delete`**, **`/lock`**, **`/unlock`**.

## Orders (заказы в зале / на столах)
- **`POST /api/1/order/create`** — { organizationId, terminalGroupId, order, createOrderSettings? } → orderInfo. order: tableIds, customer, phone, guestCount, items, combos, payments, discountsInfo, loyaltyInfo, orderTypeId, chequeAdditionalInfo. (v7.4.6+, команда)
- **`/api/1/order/by_id`**, **`/by_table`** (tableIds, statuses New/Bill/Closed/Deleted, dateFrom/To — 90 дней), **`/add_items`**, **`/close`**, **`/cancel`** (v9.0.5), **`/change_payments`**, **`/change_external_data`**, **`/init_by_table`**, **`/init_by_posOrder`**, **`/add_customer`**, **`/add_payments`**.
- **Webhooks `TableOrderUpdate`, `TableOrderError`**.

## Banquets/reserves (банкеты/резервы)
- **`/api/1/reserve/available_organizations`**, **`/available_terminal_groups`**, **`/available_restaurant_sections`** (returnSchema — схема столов), **`/restaurant_sections_workload`** (брони по секциям).
- **`/api/1/reserve/create`** — { organizationId, terminalGroupId, customer, phone, durationInMinutes, tableIds, estimatedStartTime, guests… } → reserveInfo.
- **`/status_by_id`**, **`/add_items`** (банкет), **`/cancel`** (ClientNotAppeared/ClientRefused/Other), **`/add_payments`**, **`/change_tables`**, **`/change_items`**, **`/change_estimated_start_time`**.
- **Webhooks `ReserveUpdate`, `ReserveError`**.

## Webhooks
- **`POST /api/1/webhooks/settings`** — { organizationId } → apiLoginName, webHooksUri, authToken, webHooksFilter.
- **`POST /api/1/webhooks/update_settings`** — { organizationId, **webHooksUri**, authToken?, webHooksFilter? }. Фильтры: deliveryOrderFilter, tableOrderFilter, reserveFilter, stopListUpdateFilter, personalShiftFilter, nomenclatureUpdateFilter, businessHoursAndMappingUpdateFilter.
- События (POST на webHooksUri, массив): DeliveryOrderUpdate/Error, TableOrderUpdate/Error, ReserveUpdate/Error, StopListUpdate, PersonalShift. Каждое: { eventType, eventTime, organizationId, correlationId, eventInfo }. Обработчик обязан вернуть 200.

## Deprecated
- `POST /api/1/deliveries/update_order_payments` → использовать change_payments.
- `GET /api/1/organizations` → использовать POST.

---

# Лояльность и скидки (наш основной раздел)

## Discounts and promotions
- **`POST /api/1/loyalty/iiko/calculate`** — { order, coupon?, referrerId?, terminalGroupId?, availablePaymentMarketingCampaignIds, organizationId } → loyaltyProgramResults[], availablePayments[], Warnings[]. Предрасчёт скидок/бонусов/комбо.
- **`POST /api/1/loyalty/iiko/manual_condition`** — { organizationId } → manualConditions[] (GET-подобный).
- **`POST /api/1/loyalty/iiko/program`** — { withoutMarketingCampaigns?, organizationId } → Programs[].
- **`POST /api/1/loyalty/iiko/coupons/info`** — { number, series?, organizationId } → couponInfo[].
- **`POST /api/1/loyalty/iiko/coupons/series`** — { organizationId } → seriesWithNotActivatedCoupons[].
- **`POST /api/1/loyalty/iiko/coupons/by_series`** — { series, pageSize, page, organizationId } → notActivatedCoupon[].

## Customer categories
- **`POST /api/1/loyalty/iiko/customer_category`** — { organizationId } → guestCategories[].
- **`POST /api/1/loyalty/iiko/customer_category/add`** — { customerId, categoryId, organizationId }.
- **`POST /api/1/loyalty/iiko/customer_category/remove`** — { customerId, categoryId, organizationId }.
- ⚠️ Процент скидки/кэшбека самой категории через API НЕ меняется — только назначение/снятие категории гостю. Проценты настраиваются в iikoOffice/iikoWeb (iikoCard).

## Customers
- **`POST /api/1/loyalty/iiko/customer/info`** — { phone, type:"phone", organizationId } → id, referrerId, name, surname, middleName, phone, birthday, email, sex, **cards[]** (id, track, number), **categories[]** (id, name, isActive, isDefaultForNewGuests), **walletBalances[]** (id, name, type, balance), whenRegistered, lastProcessedOrderDate, firstOrderDate, consentStatus…
- **`POST /api/1/loyalty/iiko/customer/create_or_update`** — { id?/phone/cardTrack+cardNumber, name, surName, birthday, email, sex, consentStatus, referrerId?, isDeleted?, nullifyEmptyFields?, organizationId } → { id }.
- **`POST /api/1/loyalty/iiko/delete_customers`** / **`/restore_customers`** — { customerIds, organizationId } → total/deleted(restored)/notFound.
- **`POST /api/1/loyalty/iiko/customer/program/add`** — { customerId, programId, organizationId } → userWalletId, walletId.
- **`POST /api/1/loyalty/iiko/customer/card/add`** / **`/remove`** — { customerId, cardTrack, cardNumber?, organizationId }.
- **`POST /api/1/loyalty/iiko/customer/wallet/hold`** — { transactionId?, customerId, walletId, sum, comment?, organizationId } → transactionId. (Удержание; оплата на POS.)
- **`POST /api/1/loyalty/iiko/customer/wallet/cancel_hold`** — { transactionId, organizationId }.
- **`POST /api/1/loyalty/iiko/customer/wallet/topup`** — { customerId, walletId, sum(>0), comment?, organizationId }. Начислить.
- **`POST /api/1/loyalty/iiko/customer/wallet/chargeoff`** — { customerId, walletId, sum(>0), comment?, organizationId }. Списать.
- **`POST /api/1/loyalty/iiko/get_counters`** ⭐ — { guestIds[], periods[], metrics[], organizationId } → counters[] { guestId, period, metric, value }.
  - **periods (строки в запросе):** AllTime(0) Day(1) Week(2) Month(3) Quarter(4) Year(5).
  - **metrics (строки в запросе):** OrdersCount, OrdersSum. В ответе: metric 1=OrdersSum, 2=OrdersCount.
  - Покупки за 30д ≈ period Month + metric OrdersCount.

## Messages
- **`POST /api/1/loyalty/iiko/check_sms_sending_possibility`** — { organizationId } → status, availableSmsCount.
- **`POST /api/1/loyalty/iiko/message/send_sms`** — { phone, text, organizationId } → smsId.
- **`POST /api/1/loyalty/iiko/check_sms_status`** — { smsIds, organizationId } → statuses[].
- **`POST /api/1/loyalty/iiko/message/send_email`** — { receiver, subject, body, organizationId }.

## Report (история операций гостя) ⭐
- **`POST /api/1/loyalty/iiko/customer/transactions/by_revision`** — { customerId, revision, lastTransactionId?, pageSize, organizationId } → transactions[], lastRevision, lastTransactionId, pageSize.
- **`POST /api/1/loyalty/iiko/customer/transactions/by_date`** — { customerId, dateFrom, dateTo (UTC), pageNumber, pageSize, organizationId } → transactions[], pageSize, pageNumber.
  - Поля транзакции: id, **type/typeName** (напр. 5=CloseOrder — закрытие чека/покупка; 10=RefillWalletFromOrder — начисление баллов с заказа), **sum**, **orderSum**, orderNumber, **walletId**, **balanceBefore/balanceAfter**, whenCreated, whenCreatedOrder, comment, marketingCampaignId, programId, terminalGroupId, isDelivery.
  - Даёт покупки (CloseOrder) и операции с баллами (walletId != null) БЕЗ вебхуков.

---

# Inventory (склад) — `/api/inventory/v1/...`
Документы со статусами NEW/PROCESSED/DELETED; операции create/get/list(from,to)/post/unpost/cancel/update.
- **incoming_invoice** (приходная накладная) + `.../add_payment`, `.../set_payment_date`. Поля: counteragent, date, defaultStore, items, dueDate, incomingDocumentNumber…
- **outgoing_invoice** (расходная) + **`/api/inventory/v1/costings/calculate`** (себестоимость номенклатуры на дату).
- **returned_invoice** (возврат поставщику; incomingInvoiceId).
- **incoming_returned_invoice** (возврат от клиента; processingMode: RETURN_DISH / RETURN_GOOD / DO_NOT_RETURN).
- **sales_document** (продажа: списание склада + выручка; banquet flag).
- **writeoff_document** (списание; storeFrom, expenseAccount).
- **internal_transfer** (перемещение между складами; storeFrom→storeTo).
- **production_document** (производство; ингредиенты из ТТК).
- **disassemble_document** (разбор; product+amount на уровне документа, items с mainProductAmountPercent, сумма %=100).
- **transformation_document** (переработка; ингредиенты явно).
- **`POST /api/inventory/v1/counteragents`** — { limit, offset, organizationId, type:[supplier|employee|client] } → counteragents[], totalCount.
- **`POST /api/inventory/v1/nomenclature/update_barcodes`** — { productId, barcodes[], organizationId } (полная замена штрихкодов).

# Finance (финансы) — `/api/finance/v1/...`
- **incoming_service** (акт входящих услуг) + create/get/list/post/unpost/cancel/update.
- **outgoing_service** (акт исходящих услуг).
- **`POST /api/finance/v1/account_transactions/list`** — { accountId, from, to, organizationId } → items[], startBalance, sumTotal.
- **`POST /api/finance/v1/document_transactions/list`** — { documentId, organizationId } → транзакции документа (from/to стороны, sum, type…).

---

Примечание: это структурный справочник (все методы + назначение + ключевые поля) из переданной
заказчиком OpenAPI-документации. Точные схемы request/response body по каждому методу — в ReDoc iikoCloud API.
Практически используемые в проекте методы с примерами — в `IIKO-API-REFERENCE.md`.
