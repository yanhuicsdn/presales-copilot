import Foundation

/// Disk-backed pending upload queue for offline / poor-network resilience (Section 4.2 & 10).
/// Stores ONLY text segments (never audio!) and guarantees ordered catch-up after reconnect.
public actor PendingQueueStore {
    private let fileURL: URL
    private var items: [OutgoingSegmentPayload] = []

    public init(storageURL: URL? = nil) {
        if let storageURL {
            self.fileURL = storageURL
        } else {
            let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            let dir = appSupport.appendingPathComponent("PreSalesCopilot", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            self.fileURL = dir.appendingPathComponent("pending_segments_queue.json")
        }
        self.items = Self.loadFromDisk(url: self.fileURL)
    }

    public func count(forGroup groupId: String? = nil) -> Int {
        guard let groupId else { return items.count }
        return items.filter { $0.groupId == groupId }.count
    }

    public func allItems(forGroup groupId: String? = nil) -> [OutgoingSegmentPayload] {
        let filtered = groupId == nil ? items : items.filter { $0.groupId == groupId }
        return filtered.sorted { $0.seq < $1.seq }
    }

    public func enqueue(_ segment: OutgoingSegmentPayload) {
        if !items.contains(where: { $0.groupId == segment.groupId && $0.seq == segment.seq }) {
            items.append(segment)
            items.sort {
                if $0.groupId == $1.groupId { return $0.seq < $1.seq }
                return $0.groupId < $1.groupId
            }
            persist()
        }
    }

    public func markAcked(groupId: String, seqs: [Int]) {
        let ackSet = Set(seqs)
        let before = items.count
        items.removeAll { $0.groupId == groupId && ackSet.contains($0.seq) }
        if items.count != before {
            persist()
        }
    }

    public func clear(forGroup groupId: String) {
        items.removeAll { $0.groupId == groupId }
        persist()
    }

    private func persist() {
        do {
            let dir = fileURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(items)
            try data.write(to: fileURL, options: .atomic)
        } catch {
            // Best-effort local persistence
        }
    }

    private static func loadFromDisk(url: URL) -> [OutgoingSegmentPayload] {
        guard let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode([OutgoingSegmentPayload].self, from: data) else {
            return []
        }
        return decoded
    }
}
