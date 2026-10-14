import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

// Загрузка данных с перезапросом при смене path. reload() - перечитать после изменений.
// stale = на экране ещё ответ для прошлого path (например, другого дня): его нельзя править.
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true, path: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(path).then(
      (data) => !cancelled && setState({ data, error: null, loading: false, path }),
      (error) => !cancelled && setState({ data: null, error, loading: false, path })
    );
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, stale: state.path !== path, reload };
}
