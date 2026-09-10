from fastapi import FastAPI

app = FastAPI(title="AI Code Evaluation Platform", version="0.1.0")


@app.get("/health")
async def health():
    return {"status": "ok"}
