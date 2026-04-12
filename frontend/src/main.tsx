import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AleoWalletProvider } from '@provablehq/aleo-wallet-adaptor-react'
import { WalletModalProvider } from '@provablehq/aleo-wallet-adaptor-react-ui'
import { LeoWalletAdapter }    from '@provablehq/aleo-wallet-adaptor-leo'
import { PuzzleWalletAdapter } from '@provablehq/aleo-wallet-adaptor-puzzle'
import { ShieldWalletAdapter } from '@provablehq/aleo-wallet-adaptor-shield'
import { FoxWalletAdapter }    from '@provablehq/aleo-wallet-adaptor-fox'
import { SoterWalletAdapter }  from '@provablehq/aleo-wallet-adaptor-soter'
import { DecryptPermission }   from '@provablehq/aleo-wallet-adaptor-core'
import { Network }             from '@provablehq/aleo-types'
import '@provablehq/aleo-wallet-adaptor-react-ui/dist/styles.css'
import App from './App.tsx'
import { ToastProvider } from './components/Toast.tsx'
import OnboardingTutorial from './components/OnboardingTutorial.tsx'
import './index.css'

const wallets = [
  new LeoWalletAdapter({ appName: 'ZKPoll' }),
  new PuzzleWalletAdapter({ appName: 'ZKPoll' }),
  new ShieldWalletAdapter({ appName: 'ZKPoll' }),
  new FoxWalletAdapter({ appName: 'ZKPoll' }),
  new SoterWalletAdapter({ appName: 'ZKPoll' }),
]

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AleoWalletProvider
        wallets={wallets}
        network={Network.TESTNET}
        decryptPermission={DecryptPermission.AutoDecrypt}
        programs={['zkpoll_v2_core.aleo']}
        autoConnect
      >
        <WalletModalProvider network={Network.TESTNET}>
          <ToastProvider>
            <App />
            <OnboardingTutorial />
          </ToastProvider>
        </WalletModalProvider>
      </AleoWalletProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
