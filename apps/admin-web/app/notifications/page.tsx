import { getCurrentFacilityId } from '@/lib/facility';
import { NotificationList } from './NotificationList';

// 목록은 브라우저에서 불러오고(get_my_notifications), 어느 사업장 알림을 보일지는 서버의 현재 사업장으로 정한다
export default async function NotificationsPage() {
  const facilityId = await getCurrentFacilityId();
  return <NotificationList facilityId={facilityId} />;
}
