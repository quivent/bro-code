# bro-shared

Tiny shared package for dual-pane, multi-endpoint, and crosstalk features.

## Usage in a variant (e.g. gemma-code)

```ts
import { streamToPane, startCrosstalk, createInitialDualState, type DualChatState } from 'bro-shared';
import { DualPane } from 'bro-shared/components';
```

See the `lib/dual-chat.ts` for the API.

## For core bro-code

Variants that want dual support can configure `endpoints` array in their config and import these primitives.
