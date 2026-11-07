// Supabase 및 서비스 설정 파일
// Supabase 대시보드 (Project Settings -> API)에서 복사하여 아래에 입력하세요.
const CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_ID.supabase.co", // 여기에 Supabase URL을 입력하세요
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY",          // 여기에 Supabase Anon (Publishable) Key를 입력하세요
  OPENAI_API_KEY: "" // (선택 사항: LLM API 직접 호출 시 입력 가능, 기본은 내장 룰베이스 RAG로 즉시 동작)
};

// 브라우저 전역 객체 등록
window.APP_CONFIG = CONFIG;
