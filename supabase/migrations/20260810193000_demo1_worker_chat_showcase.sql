-- Keep the W facility worker demo chat useful after the daily showcase refresh.
-- Production conversations are still created by trg_seed_chat_on_accept.
WITH target AS (
  SELECT a.id
  FROM public.shift_applications a
  JOIN public.workers w ON w.id = a.worker_id
  JOIN public.shifts s ON s.id = a.shift_id
  JOIN public.facilities f ON f.id = s.facility_id
  WHERE w.is_demo = true
    AND w.kakao_id = 'kakao_demo_gwangju_gwangsan_02'
    AND f.is_demo = true
    AND f.name LIKE 'W여성%'
    AND a.status IN ('accepted', 'completed')
  ORDER BY s.shift_date DESC, s.start_time DESC
  LIMIT 1
), messages(sender_type, body, offset_minutes) AS (
  VALUES
    ('system', E'채용이 확정됐어요! 🎉\n근무 일정과 출퇴근 안내를 이 채팅에서 확인하세요.', 0),
    ('facility', '안녕하세요. 내일 외래 근무는 오전 7시 시작입니다. 도착하면 앱에서 출근하기를 눌러주세요.', 1),
    ('worker', '네, 확인했습니다. 10분 전에 도착해서 출근 인증하겠습니다.', 2)
)
INSERT INTO public.chat_messages(application_id, sender_type, sender_id, body, created_at)
SELECT target.id, messages.sender_type, NULL, messages.body,
       now() - interval '5 minutes' + make_interval(mins => messages.offset_minutes)
FROM target CROSS JOIN messages
WHERE NOT EXISTS (
  SELECT 1 FROM public.chat_messages existing WHERE existing.application_id = target.id
);
