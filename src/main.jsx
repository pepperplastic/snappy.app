import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import CRM from './CRM'

const isCRM = window.location.pathname === '/crm'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isCRM ? <CRM /> : <App />}
  </React.StrictMode>
)
