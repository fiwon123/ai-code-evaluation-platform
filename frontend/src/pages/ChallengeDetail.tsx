import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.tsx";
import { challengesApi, ApiError } from "../services/api.ts";
import type { Challenge } from "../types.ts";

function ChallengeDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) {
      return;
    }
    const challengeId = id;
    let cancelled = false;
    async function load() {
      try {
        const data = await challengesApi.get(challengeId);
        if (!cancelled) {
          setChallenge(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.detail : "Failed to load challenge.",
          );
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
  }, [id]);

  const isOwner = challenge != null && user?.id === challenge.owner_id;

  async function handleDelete() {
    if (!challenge || !confirm(`Delete challenge "${challenge.title}"?`)) {
      return;
    }
    setDeleting(true);
    try {
      await challengesApi.remove(challenge.id);
      navigate("/challenges");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.detail : "Failed to delete challenge.",
      );
      setDeleting(false);
    }
  }

  if (loading) {
    return <p>Loading challenge…</p>;
  }

  if (error || !challenge) {
    return (
      <div>
        <p role="alert">{error ?? "Challenge not found."}</p>
        <p>
          <Link to="/challenges">Back to challenges</Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <p>
        <Link to="/challenges">Back to challenges</Link>
      </p>
      <h1>{challenge.title}</h1>
      <p>
        Language: <code>{challenge.language}</code>
      </p>
      <h2>Description</h2>
      <p>{challenge.description}</p>
      <h2>Prompt</h2>
      <pre>{challenge.prompt}</pre>
      <h2>Test code</h2>
      <pre>{challenge.test_code || "(none)"}</pre>
      {isOwner && (
        <button type="button" onClick={() => void handleDelete()} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete challenge"}
        </button>
      )}
    </div>
  );
}

export default ChallengeDetail;