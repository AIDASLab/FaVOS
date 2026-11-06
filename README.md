# FaVOS
[NeurIPS 2026 E&D] Official Implementation for "When Predicting Nothing Beats SAM 3: Revisiting Evaluation in Video Object Segmentation"

[Project page](https://aidaslab.github.io/FaVOS) | [Paper](https://arxiv.org/abs/2610.02946) | [Dataset](https://huggingface.co/datasets/snu-aidas/FaVOS)

FaVOS evaluation uses the first annotated frame as the prompt frame. Metrics are
computed on the remaining frames only.

## Evaluation Procedure

Download and extract the dataset:

```bash
huggingface-cli download snu-aidas/FaVOS --repo-type dataset --local-dir data
unzip data/JPEGImages.zip -d data
unzip data/Annotations.zip -d data
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Prepare predictions with the same IDs and frame names as the annotations:

```text
predictions/Annotations/<video_id>/<frame>.png
```

Run J&F_v evaluation:

```bash
python eval_jnf_v.py --pred-root predictions --output-dir results/jf_v
```

The evaluator uses `favos-20.txt` and `favos-40.txt` automatically.

## Citation

```bibtex
@inproceedings{hong2026favos,
  title     = {When Predicting Nothing Beats SAM 3: Revisiting Evaluation in Video Object Segmentation},
  author    = {Hong, Jihwan and Park, Woohyeon and Kim, Jaeik and Do, Jaeyoung},
  booktitle = {Advances in Neural Information Processing Systems},
  year      = {2026},
  note      = {Evaluations \& Datasets Track}
}
```
