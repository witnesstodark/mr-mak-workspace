# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
"""LLM2Vec encoder wrapper for Kimodo text conditioning."""

import os
import gc
import numpy as np
import torch
from torch import nn
from .llm2vec import LLM2Vec


class LLM2VecEncoder(nn.Module):
    """LLM2Vec text embeddings."""

    def __init__(
        self,
        base_model_name_or_path: str,
        peft_model_name_or_path: str,
        dtype: str,
        llm_dim: int,
    ) -> None:
        super().__init__()
        self.torch_dtype = getattr(torch, dtype)
        self.llm_dim = llm_dim
        # Update this path to where your model is actually located!
        self.custom_dir = "__MODEL_DIR__"
        print(f"[LLM2VecEncoder] Initialized (Waiting for first use to load weights)...")
        self.model = None

    def unload(self):
        """Offload the model weights to System RAM (CPU) if currently on GPU."""
        if self.model is not None:
            if self.get_device().type == "cuda":
                print(f"[LLM2VecEncoder] Offloading 5.4GB model to System RAM...")
                self.model.model.to("cpu")
                gc.collect()
                import platform
                if platform.system() == "Linux":
                    try:
                        import ctypes
                        ctypes.CDLL("libc.so.6").malloc_trim(0)
                    except Exception:
                        pass
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()

    def reload(self):
        """Move from System RAM to VRAM."""
        if self.model is None:
            print(f"[LLM2VecEncoder] Model was None. Reloading from disk (15s delay)...")
            self.model = LLM2Vec.from_pretrained(
                base_model_name_or_path=self.custom_dir,
                peft_model_name_or_path=None,
                torch_dtype=self.torch_dtype,
                device_map="cpu"
            )

        from kimodo.demo.memory_manager import manager
        manager.ensure_vram_capacity(5400 * 1024 * 1024, device="cuda:0", exclude_name="text_encoder")

        curr_device = self.get_device()
        if curr_device.type != "cuda":
            print(f"[LLM2VecEncoder] Moving weights to GPU (cuda:0)...")
            self.model.model.to("cuda:0")

            gc.collect()
            import platform
            if platform.system() == "Linux":
                try:
                    import ctypes
                    ctypes.CDLL("libc.so.6").malloc_trim(0)
                except Exception:
                    pass
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()

            manager.log_memory_usage("Encoder Transfer Complete (RAM Reclaimed)")
        else:
            print(f"[LLM2VecEncoder] Model already on GPU ({curr_device})")

    def get_device(self):
        if self.model is None:
            return torch.device("cpu")
        for p in self.model.model.parameters():
            if p.device.type != "meta":
                return p.device
        return torch.device("cpu")

    def delete(self):
        """Reclaim RAM without deleting from disk unless absolutely necessary."""
        # We no longer delete the model by default to avoid slow reloads.
        # Just unload to CPU instead.
        self.unload()

    def __call__(self, text: list[str] | str):
        self.reload()  # Auto-reload if called
        is_string = False
        if isinstance(text, str):
            text = [text]
            is_string = True

        results = []
        for t in text:
            with torch.no_grad():
                emb = self.model.encode([t])
                results.append(emb)

        encoded_text = np.concatenate(results, axis=0)

        assert len(encoded_text.shape)
        assert self.llm_dim == encoded_text.shape[-1]

        encoded_text = encoded_text[:, None]
        lengths = np.ones(len(encoded_text), dtype=int).tolist()

        if is_string:
            encoded_text = encoded_text[0]
            lengths = lengths[0]

        encoded_text = torch.tensor(encoded_text).to(self.get_device())
        return encoded_text, lengths
