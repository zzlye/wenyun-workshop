import { useQuery } from "@tanstack/react-query";
import { fetchVideoCapabilities } from "../lib/videoCapabilities";
import { CANVAS_VIDEO_BASE_URL } from "../lib/videoModel";

export function useVideoCapabilities(apiKey: string, proxy: boolean, model: string) {
    return useQuery({
        queryKey: ["video-capabilities", CANVAS_VIDEO_BASE_URL, apiKey.trim(), proxy, model],
        queryFn: ({ signal }) => fetchVideoCapabilities(apiKey, proxy, model, signal),
        enabled: Boolean(apiKey.trim() && model.trim()),
        staleTime: 60_000,
        retry: false,
    });
}
