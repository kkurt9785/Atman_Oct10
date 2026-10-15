import { requireAdminSession } from '@/lib/admin-auth';
import { NewSiteForm } from './NewSiteForm';

export default async function NewSitePage() {
  await requireAdminSession();
  return <NewSiteForm />;
}
