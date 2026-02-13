interface Props {
  status: string
}

export default function StatusBadge({ status }: Props): JSX.Element {
  const getClassName = (): string => {
    switch (status.toLowerCase()) {
      case 'succeeded':
        return 'badge-success'
      case 'failed':
        return 'badge-error'
      case 'cancelled':
      case 'suspended':
        return 'badge-warning'
      case 'running':
      case 'waiting':
        return 'badge-info'
      default:
        return 'badge-default'
    }
  }

  return <span className={`status-badge ${getClassName()}`}>{status}</span>
}
