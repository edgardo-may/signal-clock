import CentralLayout from '../components/CentralLayout'
import AuditView from '../../shared/components/Audit/AuditView'

export default function CentralAuditPage() {
  return (
    <CentralLayout>
      <AuditView scope="central" />
    </CentralLayout>
  )
}
