-- Milestone 7: public pages format prices and dates with each market's settings (currency, time
-- zone, digit style) as configured in Platform > Markets. Only enabled markets, only display fields.
create view app.pub_markets with (security_barrier) as
  select code, name_en, name_ar, currency, time_zone, numbering_system, date_style
    from app.markets where status = 'enabled';
grant select on app.pub_markets to baytline_app;
