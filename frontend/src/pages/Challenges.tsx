import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { challengesApi } from "../services/api.ts";
import type { Challenge } from "../types.ts";

function Challenges() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await challengesApi.list();
        if (!cancelled) {
          setChallenges(data);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load challenges.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p>Loading challenges…</p>;
  }

  if (error) {
    return <p role="alert">{error}</p>;
  }

  return (
    <div>
      <h1>Challenges</h1>
      <p>
        <Link to="/challenges/new">Create challenge</Link>
      </p>
      {challenges.length === 0 ? (
        <p>No challenges yet. Create the first one!</p>
      ) : (
        <ul>
          {challenges.map((challenge) => (
            <li key={challenge.id}>
              <Link to={`/challenges/${challenge.id}`}>{challenge.title}</Link>
              <span> — {challenge.language}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default Challenges;