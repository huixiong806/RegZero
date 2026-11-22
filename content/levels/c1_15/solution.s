# 修复 Bug：sum_sq 内部调用 square 覆盖了 ra，用栈 sp 保存并恢复 ra！
mv   a0, t0
mv   a1, t1
jal  ra, sum_sq
mv   t2, a0
j    done

sum_sq:
addi sp, sp, -4
sw   ra, 0(sp)
jal  ra, square
mv   t3, a0
mv   a0, a1
jal  ra, square
add  a0, t3, a0
lw   ra, 0(sp)
addi sp, sp, 4
ret

square:
mul  a0, a0, a0
ret

done:
ecall
