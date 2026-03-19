import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import SnappyGoldCRM from './crm'

const isCRM = window.location.pathname === '/crm'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isCRM ? <SnappyGoldCRM /> : <App />}
  </React.StrictMode>
)
