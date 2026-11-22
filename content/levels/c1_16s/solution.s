# 挑战：高速计算第 t0 个斐波那契数 F(t0) 存入 t1
addi t1, zero, 0
addi t2, zero, 1
loop:
beq  t0, zero, done
add  t3, t1, t2
mv   t1, t2
mv   t2, t3
addi t0, t0, -1
j    loop
done:
ecall
