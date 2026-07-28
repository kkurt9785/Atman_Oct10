import { getShop } from '@/lib/db/shop';
import NewShiftForm from './NewShiftForm';

export default async function NewShiftPage() {
  const shop = await getShop();
  return <NewShiftForm facilityType={shop?.facilityType ?? 'clinic'} />;
}
