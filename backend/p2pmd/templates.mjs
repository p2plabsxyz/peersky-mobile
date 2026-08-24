export const IEEE_MARKER = '<!-- ieee -->'

export const P2PMD_TEMPLATES = [
  {
    id: 'research-paper-md',
    label: 'Research Paper',
    description: 'Journal-style markdown template with KaTeX equations and table',
    slideTemplate: false,
    ieeeMode: true,
    content: `${IEEE_MARKER}

## Lorem Ipsum: A Sample Research Paper

**Author One** [1]  
**Author Two** [1]  
**Author Three** [2]  
**Author Four** [2]

[1] Lorem University  
[1] Ipsum Labs  
[2] Sit Amet Corp  
[2] Sit Amet Corp

author.one@lorem.edu  
author.two@lorem.edu  
author.three@ipsum.org  
author.four@ipsum.org

### Abstract

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.

### 1. Introduction

Sed ut *perspiciatis* unde omnis iste natus error sit voluptatem accusantium doloremque laudantium. **Totam rem aperiam**, eaque ipsa quae ab illo inventore veritatis et quasi [architecto beatae](https://republic.p2plabs.xyz/) vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.

#### 1.1 Background

Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet. Consectetur adipisci velit sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.

### 2. Method

We define the throughput metric as:

$$
T = \\frac{N_{ops}}{\\Delta t} \\cdot \\eta
$$

where $N_{ops}$ is total operations, $\\Delta t$ is elapsed time, and $\\eta$ is the efficiency coefficient.

### 3. Results

| Model | Accuracy | Latency (ms) | Throughput |
| --- | ---: | ---: | ---: |
| Baseline | 78.2% | 142 | 1.0x |
| Proposed | 91.5% | 87 | 1.6x |
| Optimized | 93.1% | 64 | 2.1x |

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

![Fig. 1: Server-based network topology](https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/Server-based-network.svg/1280px-Server-based-network.svg.png)

\`\`\`
Client --> Gateway --> Scheduler
                        |
                   Worker Pool
\`\`\`
*Fig. 2: Request processing pipeline*

### 4. Conclusion

Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam nisi ut aliquid ex ea commodi consequatur.

### References

- [1] Lorem, I. (2025). *Dolor Sit Amet.* Journal of Ipsum Studies.
- [2] Consectetur, A. (2024). *Adipiscing Elit.* Proceedings of Sed.
`
  },
  {
    id: 'technical-doc-md',
    label: 'Technical Documentation',
    description: 'Implementation-focused markdown template with API table and math',
    slideTemplate: false,
    ieeeMode: false,
    content: `## Technical Documentation: P2P Sync Service

### Overview

This document describes the sync protocol, expected request/response shapes,
and operational safeguards for the P2P markdown collaboration service.

### Quick Start

1. Create room
2. Join with key
3. Stream incremental updates

### API Surface

| Endpoint | Method | Purpose |
| --- | --- | --- |
| /api/room | POST | Create or join room |
| /api/update | POST | Push incremental update |
| /api/events | GET (SSE) | Receive remote updates |

### Throughput Estimate

$$
R = \\frac{B}{S}
$$

where $R$ is updates/sec, $B$ is network bandwidth, and $S$ is average payload size.

### Notes

- Keep payloads small and incremental.
- Retry idempotent operations on transient failures.
- Log room events for debugging and auditability.
`
  }
]

export function getP2pmdTemplate (templateId) {
  return P2PMD_TEMPLATES.find((template) => template.id === templateId) || null
}

export function hasIeeeMarker (content) {
  return /^\s*<!--\s*ieee\s*-->/i.test(String(content || ''))
}
