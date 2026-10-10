import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatWindow } from './components/ChatWindow';
import { TokenBudgetBar } from './components/TokenBudgetBar';
import { postMessage } from './hooks/useExtensionMessage';

function App() {
  useEffect(() => {
    // Tell extension we're mounted and ready to receive messages
    postMessage('webview_ready', {});
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <ChatWindow />
      <TokenBudgetBar />
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
