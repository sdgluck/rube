/** Human names for the things a rule can depend on, and for the rule types
 *  themselves. Kept apart from the pack data so the catalogue stays pure
 *  content and the presentation layer owns the wording. */
export const REQUIREMENT_LABELS: Record<string, string> = {
  omdb: "OMDb",
  seerr: "Overseerr",
  tmdb: "TMDb",
  llm: "an AI provider",
  mdblist: "MDBList",
};

export const RULE_TYPE_LABELS: Record<string, string> = {
  ai_prompt: "AI Prompt",
  top_rated: "Top Rated",
  lowest_rated: "Lowest Rated",
  actors: "Actors",
  directors: "Directors",
  studios: "Studios",
  networks: "Networks",
  genres: "Genres",
  countries: "Countries",
  content_ratings: "Content Ratings",
  imdb_chart: "IMDb Chart",
  imdb_list: "IMDb List",
  list_source: "List Source",
  smart_filter: "Smart Filter",
  rt_top_rated: "RT Top Rated",
  seerr_requests: "Seerr Requests",
  tmdb_popular_actors: "Popular Actors",
  tmdb_popular_directors: "Popular Directors",
  tmdb_franchises: "Franchises",
  decades: "Decades",
  years: "Years",
  resolutions: "Resolutions",
  audio_languages: "Audio Languages",
  subtitle_languages: "Subtitle Languages",
  video_formats: "Video Formats",
  streaming: "Streaming",
  based_on: "Based On",
  seasonal: "Seasonal",
  awards: "Awards",
};
