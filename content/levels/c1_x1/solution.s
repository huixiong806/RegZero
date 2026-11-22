# 性能挑战：解码输入中的游程编码（如 "3A2B12C" → "AAABBCCCCCCCCCCCC"）
li   t0, 0xF0000000
li   t1, 0xF0000004
addi t3, zero, 0
addi t5, zero, 10
read_loop:
lbu  t2, 0(t1)
beq  t2, zero, done
addi t4, t2, -48
bgeu t4, t5, emit_loop
mul  t3, t3, t5
add  t3, t3, t4
j    read_loop
emit_loop:
beq  t3, zero, read_loop
sb   t2, 0(t0)
addi t3, t3, -1
j    emit_loop
done:
addi a0, zero, 0
addi a7, zero, 0
ecall
