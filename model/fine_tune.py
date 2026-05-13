"""
Fine-tune Gemma 4 E2B/E4B on a waste classification dataset using Unsloth + LoRA.

Designed to run on a free Kaggle T4 GPU (16 GB VRAM) in under 2 hours.

Usage (Kaggle notebook or local GPU):
  python -m model.fine_tune \
      --model google/gemma-4-e2b-it \
      --data  data/train.jsonl \
      --output ./fine_tuned_ecobin \
      --push_to_hub  your-hf-username/ecobin-gemma4-e2b

The published weights can then be loaded via:
  GEMMA_BACKEND=huggingface
  GEMMA_MODEL=your-hf-username/ecobin-gemma4-e2b
"""

import argparse
import json
from pathlib import Path


def load_jsonl(path: Path) -> list[dict]:
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def fine_tune(
    model_name: str,
    data_path: Path,
    output_dir: str,
    push_to_hub: str | None,
    epochs: int,
    batch_size: int,
    lr: float,
    max_seq_len: int,
) -> None:
    try:
        from unsloth import FastLanguageModel
        from unsloth.chat_templates import get_chat_template
        _has_unsloth = True
    except ImportError:
        _has_unsloth = False
        print("Unsloth not installed — falling back to HuggingFace PEFT")

    if _has_unsloth:
        _fine_tune_unsloth(
            model_name, data_path, output_dir, push_to_hub,
            epochs, batch_size, lr, max_seq_len,
        )
    else:
        _fine_tune_hf_peft(
            model_name, data_path, output_dir, push_to_hub,
            epochs, batch_size, lr, max_seq_len,
        )


# ── Unsloth path (recommended — 2× faster, half the VRAM) ────────────────────

def _fine_tune_unsloth(model_name, data_path, output_dir, push_to_hub,
                       epochs, batch_size, lr, max_seq_len):
    from unsloth import FastLanguageModel
    from datasets import Dataset
    from trl import SFTTrainer
    from transformers import TrainingArguments

    print(f"Loading {model_name} with Unsloth …")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=model_name,
        max_seq_length=max_seq_len,
        dtype=None,        # auto: bfloat16 on Ampere+
        load_in_4bit=True, # QLoRA for T4 compatibility
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=16,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                         "gate_proj", "up_proj", "down_proj"],
        lora_alpha=32,
        lora_dropout=0.05,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )

    records = load_jsonl(data_path)
    texts = [
        tokenizer.apply_chat_template(r["messages"], tokenize=False, add_generation_prompt=False)
        for r in records
    ]
    dataset = Dataset.from_dict({"text": texts})

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=max_seq_len,
        args=TrainingArguments(
            per_device_train_batch_size=batch_size,
            gradient_accumulation_steps=4,
            num_train_epochs=epochs,
            learning_rate=lr,
            fp16=False,
            bf16=True,
            logging_steps=10,
            output_dir=output_dir,
            save_strategy="epoch",
            report_to="none",
        ),
    )

    print("Training …")
    trainer.train()

    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    print(f"Model saved to {output_dir}")

    if push_to_hub:
        print(f"Pushing to HuggingFace Hub: {push_to_hub} …")
        model.push_to_hub(push_to_hub)
        tokenizer.push_to_hub(push_to_hub)
        print(f"Published: https://huggingface.co/{push_to_hub}")


# ── HuggingFace PEFT fallback ─────────────────────────────────────────────────

def _fine_tune_hf_peft(model_name, data_path, output_dir, push_to_hub,
                        epochs, batch_size, lr, max_seq_len):
    import torch
    from transformers import (
        AutoTokenizer, AutoModelForCausalLM, TrainingArguments
    )
    from peft import LoraConfig, get_peft_model, TaskType
    from trl import SFTTrainer
    from datasets import Dataset

    print(f"Loading {model_name} with HuggingFace PEFT …")
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch.bfloat16,
        device_map="auto",
    )

    lora_config = LoraConfig(
        r=16,
        lora_alpha=32,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type=TaskType.CAUSAL_LM,
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    records = load_jsonl(data_path)
    texts = [
        tokenizer.apply_chat_template(r["messages"], tokenize=False, add_generation_prompt=False)
        for r in records
    ]
    dataset = Dataset.from_dict({"text": texts})

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=max_seq_len,
        args=TrainingArguments(
            per_device_train_batch_size=batch_size,
            gradient_accumulation_steps=4,
            num_train_epochs=epochs,
            learning_rate=lr,
            bf16=True,
            logging_steps=10,
            output_dir=output_dir,
            save_strategy="epoch",
            report_to="none",
        ),
    )

    trainer.train()
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    print(f"Model saved to {output_dir}")

    if push_to_hub:
        model.push_to_hub(push_to_hub)
        tokenizer.push_to_hub(push_to_hub)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fine-tune Gemma 4 for waste classification")
    parser.add_argument("--model",      default="google/gemma-4-e2b-it")
    parser.add_argument("--data",       type=Path, default=Path("data/train.jsonl"))
    parser.add_argument("--output",     default="./fine_tuned_ecobin")
    parser.add_argument("--push_to_hub", default=None, help="HuggingFace repo id to publish weights")
    parser.add_argument("--epochs",     type=int,   default=3)
    parser.add_argument("--batch_size", type=int,   default=2)
    parser.add_argument("--lr",         type=float, default=2e-4)
    parser.add_argument("--max_seq_len",type=int,   default=2048)
    args = parser.parse_args()

    fine_tune(
        model_name=args.model,
        data_path=args.data,
        output_dir=args.output,
        push_to_hub=args.push_to_hub,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        max_seq_len=args.max_seq_len,
    )
