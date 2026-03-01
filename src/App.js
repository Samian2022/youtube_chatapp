import { useState } from 'react';
import Auth from './components/Auth';
import Chat from './components/Chat';
import './App.css';

function App() {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('chatapp_user');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed.username
        ? parsed
        : { username: raw, firstName: '', lastName: '' };
    } catch {
      return null;
    }
  });

  const handleLogin = (userData) => {
    const u =
      typeof userData === 'object' && userData?.username
        ? userData
        : { username: userData, firstName: '', lastName: '' };
    localStorage.setItem('chatapp_user', JSON.stringify(u));
    setUser(u);
  };

  const handleLogout = () => {
    localStorage.removeItem('chatapp_user');
    setUser(null);
  };

  return (
    <>
      <div className="ambient-lamp" aria-hidden />
      {user ? <Chat user={user} onLogout={handleLogout} /> : <Auth onLogin={handleLogin} />}
    </>
  );
}

export default App;
