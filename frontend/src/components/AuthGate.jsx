import { useAuth } from '../auth/AuthContext';
import Login from './Login';

export function AuthGate({ children }) {
  const { authenticated } = useAuth();

  if (authenticated === null) {
    return (
      <div className="login-loading">
        <div className="login-loading__inner">Loading…</div>
      </div>
    );
  }

  if (!authenticated) return <Login />;

  return children;
}
