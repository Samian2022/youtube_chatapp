import { useState } from 'react';
import { createUser, findUser } from '../services/mongoApi';
import './Auth.css';

export default function Auth({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const name = username.trim().toLowerCase();
      if (mode === 'create') {
        if (!firstName.trim() || !lastName.trim()) {
          setError('First name and last name are required');
          setLoading(false);
          return;
        }
        await createUser(name, password, email.trim(), firstName.trim(), lastName.trim());
        setError('');
        setMode('login');
        setPassword('');
        setEmail('');
        setFirstName('');
        setLastName('');
      } else {
        const user = await findUser(name, password);
        if (!user) throw new Error('User not found or invalid password');
        onLogin(user);
      }
    } catch (err) {
      try {
        const j = JSON.parse(err.message);
        setError(j.error || err.message);
      } catch {
        setError(err.message || 'Something went wrong');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-header">
          <h1>Chat</h1>
          <span className="auth-accent-line" aria-hidden />
        </div>
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="auth-username">Username</label>
            <input
              id="auth-username"
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
            />
          </div>
          {mode === 'create' && (
            <>
              <div className="auth-field">
                <label htmlFor="auth-firstName">First Name</label>
                <input
                  id="auth-firstName"
                  type="text"
                  placeholder="First Name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  autoComplete="given-name"
                />
              </div>
              <div className="auth-field">
                <label htmlFor="auth-lastName">Last Name</label>
                <input
                  id="auth-lastName"
                  type="text"
                  placeholder="Last Name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  autoComplete="family-name"
                />
              </div>
              <div className="auth-field">
                <label htmlFor="auth-email">Email</label>
                <input
                  id="auth-email"
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
            </>
          )}
          <div className="auth-field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            />
          </div>
          {error && (
            <p className="auth-error" role="alert">
              {error}
              {error.includes('already exists') && ' Try logging in instead.'}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className={loading ? 'auth-loading' : ''}
          >
            {loading ? '' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode((m) => (m === 'login' ? 'create' : 'login'));
            setError('');
          }}
        >
          {mode === 'login' ? 'Create an account' : 'Already have an account? Log in'}
        </button>
      </div>
    </div>
  );
}
