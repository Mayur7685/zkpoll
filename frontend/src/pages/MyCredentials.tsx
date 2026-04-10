import ZKCredentialPanel from '../components/ZKCredentialPanel'

export default function MyCredentials() {
  return (
    <div className="max-w-md mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">My Credentials</h1>
        <p className="text-sm text-gray-500 mt-1.5 leading-relaxed max-w-sm">
          Private ZK credential records on Aleo — only your wallet can read them.
          They prove community membership without revealing your eligibility data.
        </p>
      </div>
      <ZKCredentialPanel />
    </div>
  )
}
