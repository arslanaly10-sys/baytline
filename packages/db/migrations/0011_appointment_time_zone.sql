-- Milestone 7: a confirmed appointment time is shown to the customer in the confirming
-- organization's market time zone, which the customer can't read from the organization itself.
alter table app.appointment_requests add column confirmed_time_zone text check (confirmed_time_zone is null or length(confirmed_time_zone) between 3 and 64);
grant update (confirmed_time_zone) on app.appointment_requests to baytline_app;
